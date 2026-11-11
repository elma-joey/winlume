import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { epaySign } from '../payment/epay';
const mocks=vi.hoisted(()=>({db:vi.fn(),native:vi.fn(),verify:vi.fn(),workspace:vi.fn(),active:vi.fn()}));
vi.mock('../platform/db/client',()=>({requirePlatformDb:mocks.db}));
vi.mock('../billing/gateway-plans',()=>({gatewayPlanRequest:mocks.native,verifyNativePlan:mocks.verify,organizationPat:async()=> 'fixture-pat',currentPlan:mocks.active}));
vi.mock('./workspace',()=>({requireConsoleOrganization:mocks.workspace}));
vi.mock('./server',()=>({ConsoleRequestError:class extends Error{},ensureOrganizationKeyManager:(role:string)=>{if(role!=='owner')throw new Error('Forbidden')}}));
import { createPlanPurchase } from './plan-purchases';
const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const input={organizationId:org,planId:'core',requestId:'33333333-3333-4333-8333-333333333333'};
const context={userId:user,repositories:{}};
let row:Record<string,unknown>|undefined,fetcher:ReturnType<typeof vi.fn>,uncertain=false;
beforeEach(()=>{
 row=undefined;uncertain=false;vi.clearAllMocks();
 for(const [k,v] of Object.entries({KYREN_PLANS_ENABLED:'1',REIZO_PAYHOOK_SECRET:'fixture-delivery',KYREN_API_KEY:'fixture-api',EPAY_PID:'merchant',EPAY_KEY:'fixture-epay',NEXTAUTH_URL:'https://reizo.example'}))vi.stubEnv(k,v);
 mocks.workspace.mockResolvedValue({membership:{role:'owner'}});mocks.active.mockResolvedValue(null);mocks.verify.mockResolvedValue(6);
 const nativeParams={pid:'merchant',out_trade_no:'SUBUSR1NOfixture',money:'29.00',type:'alipay',sign_type:'MD5',sign:''};nativeParams.sign=epaySign(nativeParams,'fixture-epay');
 mocks.native.mockResolvedValue({data:nativeParams});
 mocks.db.mockReturnValue({
  select:()=>({from:()=>({where:(condition:SQL)=>({limit:async()=>{
   const params=new PgDialect().sqlToQuery(condition).params;
   return row&&(params.includes(row.id)||(params.includes(row.organizationId)&&params.includes(row.status)))?[row]:[];
  },orderBy:()=>({limit:async()=>[]})})})}),
  insert:()=>({values:(value:Record<string,unknown>)=>({onConflictDoNothing:()=>({returning:async()=>{if(row)return[];row={...value,createdAt:new Date(),paidAt:null};return[row]}})})}),
  update:()=>({set:(value:Record<string,unknown>)=>({where:()=>{Object.assign(row!,value);const result=Promise.resolve();return Object.assign(result,{returning:async()=>[row]})}})}),
 });
 fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){if(uncertain)throw new Error('network timeout');return Response.json({code:0,data:{id:'cs_fixture',productId:'prod_9iIn2Z2RyMTbJ4DM',amount:'29',currency:'CNY',status:'OPEN',url:'https://payment.kyren.io/checkout/one-time/cs_fixture',expiresAt:Date.now()+60000}})}
  const prices:Record<string,string>={prod_9iIn2Z2RyMTbJ4DM:'29',prod_hvVVVVnK3kb1yQXC:'69',prod_FOV1dx3PcMIVXQUW:'129',prod_T4BnkNmgi9vRPjHU:'229'};
  const id=url.split('/').pop()!;return Response.json({code:0,data:{id,name:'fixture',price:prices[id],currency:'CNY',status:'ACTIVE',productType:'ONE_TIME'}});
 });vi.stubGlobal('fetch',fetcher);
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
it('persists one native reference and hosted checkout and reuses both for a request replay',async()=>{
 const first=await createPlanPurchase(context as never,input);
 expect(first.status).toBe('pending');expect(first.allowance).toBe(10000);
 expect(row?.nativeReference).toBe('SUBUSR1NOfixture');
 const checkout=JSON.parse(String(fetcher.mock.calls.find(call=>call[1]?.method==='POST')?.[1]?.body));
 expect(checkout.metadata).toEqual({source:'reizo',local_order_id:first.reference,businessOrderId:first.reference,organizationId:org,userId:user,nativeReference:'SUBUSR1NOfixture'});
 expect((await createPlanPurchase(context as never,input)).reference).toBe(first.reference);
 expect(mocks.native).toHaveBeenCalledOnce();expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('retains an uncertain checkout without automatically creating another order',async()=>{
 uncertain=true;await expect(createPlanPurchase(context as never,input)).rejects.toThrow('待核对');
 expect(row?.status).toBe('uncertain');
 expect((await createPlanPurchase(context as never,input)).status).toBe('crediting');
 expect(mocks.native).toHaveBeenCalledOnce();expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('resumes the same pending plan when another client submits a new request identity',async()=>{
 const first=await createPlanPurchase(context as never,input);
 const second=await createPlanPurchase(context as never,{...input,requestId:'44444444-4444-4444-8444-444444444444'});
 expect(second.reference).toBe(first.reference);expect(second.status).toBe('pending');
 expect(mocks.native).toHaveBeenCalledOnce();expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('keeps another pending plan distinct instead of charging for an unselected offer',async()=>{
 await createPlanPurchase(context as never,input);
 await expect(createPlanPurchase(context as never,{...input,planId:'plus',requestId:'44444444-4444-4444-8444-444444444444'})).rejects.toThrow('未完成');
 expect(mocks.native).toHaveBeenCalledOnce();expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('does not create another checkout for an uncertain order under a new request identity',async()=>{
 uncertain=true;await expect(createPlanPurchase(context as never,input)).rejects.toThrow('待核对');
 await expect(createPlanPurchase(context as never,{...input,requestId:'44444444-4444-4444-8444-444444444444'})).rejects.toThrow('核对');
 expect(mocks.native).toHaveBeenCalledOnce();expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('resumes a concurrent pending checkout after losing the unique-order insert',async()=>{
 const first=await createPlanPurchase(context as never,input);
 const saved=row;row=undefined;
 const db=mocks.db.mock.results[0].value;
 db.insert=()=>({values:()=>({onConflictDoNothing:()=>({returning:async()=>{row=saved;return[]}})})});
 const resumed=await createPlanPurchase(context as never,{...input,requestId:'44444444-4444-4444-8444-444444444444'});
 expect(resumed.reference).toBe(first.reference);
 expect(mocks.native).toHaveBeenCalledOnce();expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('does not resume a pending checkout whose offer amount has changed',async()=>{
 await createPlanPurchase(context as never,input);
 Object.assign(row!,{amount:'28.00'});
 await expect(createPlanPurchase(context as never,{...input,requestId:'44444444-4444-4444-8444-444444444444'})).rejects.toThrow('未完成');
 expect(mocks.native).toHaveBeenCalledOnce();expect(fetcher.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('rejects unauthorized and already active plan purchases before creating any order',async()=>{
 mocks.workspace.mockResolvedValue({membership:{role:'member'}});
 await expect(createPlanPurchase(context as never,input)).rejects.toThrow('Forbidden');
 mocks.workspace.mockResolvedValue({membership:{role:'owner'}});mocks.active.mockResolvedValue({id:'core'});
 await expect(createPlanPurchase(context as never,input)).rejects.toThrow('尚未到期');
 expect(mocks.native).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(row).toBeUndefined();
});
