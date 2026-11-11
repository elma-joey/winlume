"use client";
import Link from "next/link";


import { useEffect, useState } from "react";
import AccountAvatar from "./AccountAvatar";
import { useModals } from "@/components/providers";
import { getConsoleOverview } from "@/lib/console/client";
import type { ConsoleOverview } from "@/lib/console/types";
import type { Account } from "@/lib/account";
import { displayAllowance } from "@/lib/billing/plans";

export default function AccountOverview() {
  const { account, accountLoading, openLogin } = useModals();
  const [result, setResult] = useState<{ owner: Account["id"]; overview?: ConsoleOverview; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const userId = account?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getConsoleOverview().then(overview => { if (!cancelled) setResult({ owner: userId, overview }); }).catch(reason => { if (!cancelled) setResult({ owner: userId, error: reason instanceof Error ? reason.message : "账户信息暂不可用" }); });
    return () => { cancelled = true; };
  }, [userId, attempt]);
  const overview = result?.owner === userId ? result?.overview : undefined;
  const error = result?.owner === userId ? result?.error : undefined;
  const wallet = overview?.wallet;
  const allowance = wallet?.membershipAllowance;
  const balance = !account ? "—" : !wallet ? "读取中…" : wallet.syncStatus === "unavailable" ? "暂不可用" : `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(displayAllowance(wallet.availableCredits))} 额度`;
  return <section className="ac-panel reizo-overview">
    <div className="ac-panel-heading"><p>我的账户</p><h1>账户概览</h1></div>
    <div className="ac-profile"><AccountAvatar image={account?.image} /><div><h2>{accountLoading ? "正在读取账户…" : account ? account.display_name || account.username : "登录后，查看你的账户"}</h2><p>{account?.email || "个人资料、钱包与会员，都在这里管理。"}</p></div>{account ? <Link className="ac-button" href="/account/personalization">资料与设置 ↗</Link> : <button className="ac-button" disabled={accountLoading} onClick={() => openLogin()}>登录账户 ↗</button>}</div>
    {error && <div role="alert" className="reizo-notice">{error} <button onClick={() => setAttempt(attempt + 1)}>重试</button></div>}
    <div className="ac-section-title"><h2>可用额度</h2><Link href="/account/usage">查看明细 →</Link></div>
    <div className="ac-balances ac-balances-main"><article><p>会员月度额度 <span>当期权益</span></p><strong>{!account ? "—" : !wallet ? (error ? "暂不可用" : "读取中…") : allowance?.status === "active" ? new Intl.NumberFormat("zh-CN").format(Number(allowance.remainingUnits)) : "未开通"}</strong><small>{allowance?.status === "active" ? `重置日期：${new Date(allowance.resetsAt).toLocaleDateString("zh-CN")}` : "已开通权益以账户实际配置为准"}</small></article><article><p>账户余额 <span>工作台与 API 共用</span></p><strong>{error ? "暂不可用" : balance}</strong><small>充值与使用明细可在钱包查看</small></article></div>
    <div className="ac-overview-bottom"><section className="ac-membership-summary"><div><p>当前会员</p><h2>{!account ? "登录后查看" : wallet ? wallet.subscription.status === "active" ? wallet.subscription.name : "按量使用" : error ? "暂不可用" : "读取中…"}</h2><span>方案、有效期与权益信息</span></div><Link href="/account/pricing">管理我的权益 →</Link></section><div className="ac-quick-links"><Link href="/account/wallet"><span><strong>购买额度</strong><small>按需充值，查看账户余额</small></span><span>↗</span></Link><Link href="/pricing"><span><strong>比较会员方案</strong><small>了解模型价格与计费方式</small></span><span>↗</span></Link></div></div>
    <div className="ac-identity-summary"><div><h2>登录方式与账户关联</h2><p>{account ? account.email || "尚未绑定邮箱" : "登录后查看"}</p><small>账户安全与个人资料集中管理</small></div><Link href="/account/security">管理账户 →</Link></div>
  </section>;
}
