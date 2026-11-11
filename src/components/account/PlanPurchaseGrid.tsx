"use client";
import { useEffect,useRef,useState } from "react";
import { LoaderCircle } from "lucide-react";
import { REIZO_PLANS } from "@/lib/billing/plans";
type PlanOrder={reference:string;status:string;planName?:string;amount:number;createdAt:string};
type Snapshot={organizationId:string|null;canPurchase:boolean;plans:Array<typeof REIZO_PLANS[number]>;membership:{name:string;remainingAllowance:number;expiresAt:string}|null;orders:PlanOrder[]};
async function api(path:string,body?:unknown) {
  const r=await fetch(path,{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||"套餐信息暂不可用。");return data;
}
export default function PlanPurchaseGrid() {
  const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const attempt=useRef<{planId:string;organizationId:string;requestId:string}|null>(null),busyRef=useRef(false);
  useEffect(()=>{let active=true;void api("/api/console/plans").then(value=>{if(active){setData(value);setError("");}}).catch(e=>{if(active)setError(e.message)});const timer=setTimeout(()=>setRevision(v=>v+1),15000);return()=>{active=false;clearTimeout(timer)};},[revision]);
  async function purchase(planId?:string,reference?:string) {
    if (!data?.organizationId || busyRef.current) return;
    busyRef.current=true;setBusy(true);setError("");
    try {
      if(!reference && planId){
        if(attempt.current?.planId!==planId || attempt.current?.organizationId!==data.organizationId)attempt.current={planId,organizationId:data.organizationId,requestId:crypto.randomUUID()};
        const result=await api("/api/console/plans",attempt.current);reference=result.order.reference;
      }
      const checkout=await api(`/api/console/plans?organizationId=${data.organizationId}&order=${encodeURIComponent(reference!)}`);
      const url=new URL(checkout.url);
      if(url.protocol!=="https:" || !["payment.kyren.io","payment.kyrenpay.com"].includes(url.hostname)||url.username||url.password)throw new Error("收银台地址无效。");
      window.location.assign(url.href);
    } catch(e){setError(e instanceof Error?e.message:"订单未确认，请刷新。");setRevision(v=>v+1);}
    finally{busyRef.current=false;setBusy(false);}
  }
  return <section aria-label="额度套餐" className="space-y-4">
    {data?.membership?<div className="ac-current-plan"><h2>{data.membership.name}套餐</h2><p>{data.membership.remainingAllowance.toLocaleString("zh-CN",{maximumFractionDigits:2})} 额度</p><p>{new Date(data.membership.expiresAt).toLocaleDateString("zh-CN")} 到期</p></div>:null}
    {error?<p role="alert">{error}<button onClick={()=>setRevision(v=>v+1)}>重试</button></p>:null}
    {!data&&!error?<div role="status" aria-label="加载套餐"><LoaderCircle className="size-5 animate-spin" /></div>:null}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data?.plans.map(plan=><article className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-card p-5" key={plan.id}><h3 className="text-sm font-medium">{plan.name}</h3><p className="text-3xl font-semibold tabular-nums">¥{plan.price}<small className="ml-1 text-xs font-normal text-muted-foreground"> / 月</small></p><div className="border-t border-border pt-4"><strong className="text-xl font-semibold tabular-nums">{plan.allowance.toLocaleString("zh-CN")}</strong><span className="ml-1 text-xs text-muted-foreground">额度 / 月</span></div><p className="text-xs text-muted-foreground">额外充值 {plan.discount*10} 折</p><button className="ac-button mt-auto" disabled={busy||!data.canPurchase||!!data.membership} onClick={()=>void purchase(plan.id)}>{data.membership?.name===plan.name?"当前套餐":data.membership?"到期续购":"购买套餐"}</button></article>)}</div>
    {data?.orders.map(order=><div key={order.reference} className="ac-simple-note"><span>{order.planName} · ¥{order.amount} · {order.status==="success"?"已开通":order.status==="pending"?"待付款":order.status==="failed"?"待核对":"处理中"}</span>{order.status==="pending"?<button disabled={busy} className="ac-subtle" onClick={()=>void purchase(undefined,order.reference)}>继续付款</button>:null}</div>)}
  </section>;
}
