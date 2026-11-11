import { afterEach,expect,it,vi } from "vitest";
import { createHmac } from "node:crypto";
import worker from "../../../services/payhook-router/worker.js";
const secret="fixture-router-secret",delivery="fixture-reizo-delivery";
afterEach(()=>vi.unstubAllGlobals());
it("routes Reizo through its own delivery key, leaving both existing destinations intact",async()=>{
 const cases=[['reizo','https://reizo-ai.com/api/pay/kyren/notify','REIZO_DELIVERY_SECRET'],['by-your-side','https://side.example/notify','BYYOURSIDE_DELIVERY_SECRET'],['v2-design','https://design.example/notify','V2DESIGN_DELIVERY_SECRET']];
 for(const [source,endpoint,key] of cases){
  const payload=JSON.stringify({id:'evt_'+source,type:'order.paid',data:{metadata:{source,local_order_id:'order_fixture'}}});
  const run=vi.fn(async()=>({meta:{changes:1}}));
  const db={prepare:vi.fn(()=>({bind:()=>({run,first:async()=>({payload,state:'pending',source})})}))};
  const env={DB:db,DELIVERIES:{send:vi.fn()},KYREN_WEBHOOK_SECRET:secret,REIZO_DELIVERY_SECRET:delivery,BYYOURSIDE_DELIVERY_URL:'https://side.example/notify',V2DESIGN_DELIVERY_URL:'https://design.example/notify',BYYOURSIDE_DELIVERY_SECRET:'fixture-side',V2DESIGN_DELIVERY_SECRET:'fixture-design'};
  const timestamp=String(Date.now()),signature='sha256='+createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
  expect((await worker.fetch(new Request('https://payhook.example/kyren',{method:'POST',body:payload,headers:{'content-type':'application/json','x-kyren-timestamp':timestamp,'x-kyren-signature':signature}}),env)).status).toBe(200);
  expect(env.DELIVERIES.send).toHaveBeenCalledWith({eventId:'evt_'+source});
  const fetcher=vi.fn(async(_url:string,_init:RequestInit)=>new Response('OK'));vi.stubGlobal('fetch',fetcher);
  const message={body:{eventId:'evt_'+source},attempts:1,ack:vi.fn(),retry:vi.fn()};
  await worker.queue({messages:[message]},env);
  expect(fetcher.mock.calls[0]?.[0]).toBe(endpoint);
  const init=(fetcher.mock.calls as unknown as Array<[string,RequestInit]>)[0][1];
  const headers=init.headers as Record<string,string>;
  expect(headers['x-payhook-signature']).toBe('sha256='+createHmac('sha256',env[key as keyof typeof env] as string).update(headers['x-payhook-timestamp']+'.'+payload).digest('hex'));
  expect(message.ack).toHaveBeenCalledOnce();expect(message.retry).not.toHaveBeenCalled();
 }
});
it("keeps failed Reizo deliveries pending for queue retry",async()=>{
 const db={prepare:()=>({bind:()=>({run:async()=>({}),first:async()=>({payload:'{}',state:'pending',source:'reizo'})})})};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('retry',{status:503})));
 const message={body:{eventId:'evt_retry'},attempts:2,ack:vi.fn(),retry:vi.fn()};
 await worker.queue({messages:[message]},{DB:db,REIZO_DELIVERY_SECRET:delivery});
 expect(message.ack).not.toHaveBeenCalled();expect(message.retry).toHaveBeenCalledWith({delaySeconds:60});
});
