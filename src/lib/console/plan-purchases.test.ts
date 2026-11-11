import { createHmac } from "node:crypto";
import { beforeEach,afterEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({db:vi.fn(),native:vi.fn(),verify:vi.fn(),mapping:vi.fn()}));
vi.mock("../platform/db/client",()=>({requirePlatformDb:mocks.db}));
vi.mock("../platform/repositories",()=>({getPlatformRepositories:()=>({teamNewApiMapping:{findByOrganizationId:mocks.mapping}})}));
vi.mock("../newapi/crypto",()=>({decryptSecret:()=>"fixture-pat"}));
vi.mock("../billing/gateway-plans",()=>({gatewayPlanRequest:mocks.native,verifyNativePlan:mocks.verify,organizationPat:vi.fn(),currentPlan:vi.fn()}));
vi.mock("./server",()=>({ConsoleRequestError:class extends Error{},ensureOrganizationKeyManager:vi.fn()}));
vi.mock("./workspace",()=>({requireConsoleOrganization:vi.fn()}));
import { handleKyrenWebhook } from "./plan-purchases";
import { kyrenEvents } from "../platform/db/schema";
const secret="fixture-webhook-secret",id="RZP"+"a".repeat(28);
let row:Record<string,unknown>,events:Array<Record<string,unknown>>,fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.stubEnv("KYREN_WEBHOOK_SECRET",secret);vi.stubEnv("KYREN_API_KEY","fixture-key");vi.stubEnv("EPAY_KEY","fixture-epay");vi.stubEnv("EPAY_PID","merchant");vi.stubEnv("NEW_API_URL","https://gateway.example");
  vi.clearAllMocks();events=[];row={id,organizationId:"org",userId:"user",planId:"core",productId:"prod_9iIn2Z2RyMTbJ4DM",nativeReference:"SUBUSR1NOtest",checkoutId:"cs_test",amount:"29.00",status:"pending"};
  const tx={select:()=>({from:(table:unknown)=>({where:()=>({for:async()=>[row],limit:async()=>table===kyrenEvents?events.filter(e=>e.id===currentEventId):[row]})})}),
    update:()=>({set:(value:unknown)=>({where:async()=>Object.assign(row,value)})}),insert:()=>({values:async(value:Record<string,unknown>)=>events.push(value)})};
  mocks.db.mockReturnValue({transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)});mocks.mapping.mockResolvedValue({newApiPatCiphertext:"encrypted"});mocks.verify.mockResolvedValue(6);mocks.native.mockResolvedValue({data:{}});
  fetcher=vi.fn(async(url:string)=>url.includes('/v1/checkouts/')?Response.json({code:0,data:{id:"cs_test",productId:row.productId,amount:"29",currency:"CNY",status:"COMPLETE",url:"https://payment.kyren.io/checkout/one-time/cs_test",orderId:"order_test",expiresAt:Date.now()+10000}}):new Response("success"));
  vi.stubGlobal("fetch",fetcher);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
let currentEventId="evt_test";
function request(overrides:Record<string,unknown>={},eventId="evt_test") {
  currentEventId=eventId;
  const raw=JSON.stringify({id:eventId,type:"order.paid",created_at:Date.now(),data:{order_id:"order_test",product_id:row.productId,amount:"29",currency:"CNY",metadata:{businessOrderId:id,organizationId:"org",userId:"user",nativeReference:row.nativeReference},...overrides}});
  const t=String(Date.now()),sign="sha256="+createHmac("sha256",secret).update(t+"."+raw).digest("hex");
  return new Request("https://reizo.example/api/pay/kyren/notify",{method:"POST",body:raw,headers:{"x-kyren-timestamp":t,"x-kyren-signature":sign}});
}
it("fulfills only a matching verified checkout and duplicate paid events do not grant twice",async()=>{
  const first=request();const raw=await first.clone().text();
  expect((await handleKyrenWebhook(first)).status).toBe(200);expect(row.status).toBe("success");
  const duplicate=request(); // Preserve exact event payload for id deduplication.
  const t=String(Date.now());const sign="sha256="+createHmac("sha256",secret).update(t+"."+raw).digest("hex");
  expect((await handleKyrenWebhook(new Request(duplicate.url,{method:"POST",body:raw,headers:{"x-kyren-timestamp":t,"x-kyren-signature":sign}}))).status).toBe(200);
  expect((await handleKyrenWebhook(request({},"evt_retry_other"))).status).toBe(200);
  expect(fetcher.mock.calls.filter(c=>String(c[0]).includes('/subscription/epay/notify'))).toHaveLength(1);
  expect(mocks.native).toHaveBeenCalledWith('/api/subscription/self/preference','fixture-pat',{billing_preference:'subscription_first'},'PUT');
});
it("rejects amount, product and workspace substitution before entitlement delivery",async()=>{
  for(const input of [{amount:"28.99"},{product_id:"prod_other"},{currency:"USD"},{metadata:{businessOrderId:id,organizationId:"other",userId:"user",nativeReference:row.nativeReference}}])await expect(handleKyrenWebhook(request(input))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();expect(events).toHaveLength(0);
});
it("leaves the event unacknowledged when entitlement delivery fails so the same native order can be retried",async()=>{
  fetcher.mockImplementation(async(url:string)=>url.includes('/v1/checkouts/')?Response.json({code:0,data:{id:"cs_test",productId:row.productId,amount:"29",currency:"CNY",status:"COMPLETE",url:"https://payment.kyren.io/checkout/one-time/cs_test",orderId:"order_test",expiresAt:Date.now()+10000}}):new Response("fail"));
  await expect(handleKyrenWebhook(request())).rejects.toThrow();expect(events).toHaveLength(0);expect(row.status).toBe("pending");
});
it("rejects unsigned and oversized raw bodies before database access",async()=>{
  expect((await handleKyrenWebhook(new Request('https://reizo.example',{method:'POST',body:'{}'}))).status).toBe(400);
  expect((await handleKyrenWebhook(new Request('https://reizo.example',{method:'POST',body:'x'.repeat(65537)}))).status).toBe(413);
  expect(mocks.db).not.toHaveBeenCalled();
});
it("accepts the independently signed router delivery and rejects a substituted source",async()=>{
  vi.stubEnv('REIZO_PAYHOOK_SECRET','fixture-delivery-secret');
  const direct=request(); const event=JSON.parse(await direct.text());
  event.data.metadata.source='reizo';event.data.metadata.local_order_id=id;
  const raw=JSON.stringify(event),timestamp=String(Date.now());
  const signature='sha256='+createHmac('sha256','fixture-delivery-secret').update(timestamp+'.'+raw).digest('hex');
  const headers={'x-payhook-timestamp':timestamp,'x-payhook-signature':signature};
  expect((await handleKyrenWebhook(new Request(direct.url,{method:'POST',body:raw,headers}))).status).toBe(200);
  expect(row.status).toBe('success');
  event.data.metadata.source='v2-design';
  const changed=JSON.stringify(event),changedSignature='sha256='+createHmac('sha256','fixture-delivery-secret').update(timestamp+'.'+changed).digest('hex');
  expect((await handleKyrenWebhook(new Request(direct.url,{method:'POST',body:changed,headers:{...headers,'x-payhook-signature':changedSignature}}))).status).toBe(400);
});
