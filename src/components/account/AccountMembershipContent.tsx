"use client";
import { ConsolePage } from "@/components/console/ConsolePage";
import { useModals } from "@/components/providers";
import PlanPurchaseGrid from "./PlanPurchaseGrid";
export default function AccountMembershipContent() {
  const {account,accountLoading,openLogin}=useModals();
  return <ConsolePage title="额度套餐">{account?<PlanPurchaseGrid/>:<button className="ac-button" disabled={accountLoading} onClick={()=>openLogin()}>登录购买套餐</button>}</ConsolePage>;
}
