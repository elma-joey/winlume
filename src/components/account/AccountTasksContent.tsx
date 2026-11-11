"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConsolePage } from "@/components/console/ConsolePage";
import { useModals } from "@/components/providers";
import { getConsoleOverview } from "@/lib/console/client";
import type { ConsoleOverview } from "@/lib/console/types";
import type { Session } from "@/lib/agent/types";
import { filterTaskRecords } from "./task-records";
import { displayAllowance } from "@/lib/billing/plans";

const number = (value: number | string) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AccountTasksContent() {
  const { account, accountLoading, openLogin } = useModals();
  const [result, setResult] = useState<{ owner: string; syncedAt: number; sessions: Session[]; overview?: ConsoleOverview; error?: string; walletError?: string } | null>(null);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const userId = account?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const controller = new AbortController();
    Promise.allSettled([
      fetch("/api/sessions", { cache: "no-store", signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录。" : "任务列表暂不可用，请重试。");
        return (await response.json() as { sessions: Session[] }).sessions;
      }), getConsoleOverview(),
    ]).then(([sessions, overview]) => {
      if (cancelled) return;
      setResult({ owner: userId, syncedAt: Date.now(), sessions: sessions.status === "fulfilled" ? sessions.value : [],
        error: sessions.status === "rejected" ? String(sessions.reason instanceof Error ? sessions.reason.message : "任务读取失败") : undefined,
        overview: overview.status === "fulfilled" ? overview.value : undefined,
        walletError: overview.status === "rejected" ? "额度暂时无法同步，可前往钱包重试。" : undefined });
      setPending(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [userId, attempt]);
  const current = result?.owner === userId ? result : null;
  const loading = accountLoading || (!!account && (!current || pending));
  const wallet = current?.overview?.wallet;
  const allowance = wallet?.membershipAllowance;
  const visible = useMemo(() => filterTaskRecords(current?.sessions ?? [], query, period === "all" ? null : Number(period), current?.syncedAt ?? 0), [current, period, query]);
  const balance = !account ? "—" : !wallet ? loading ? "读取中…" : "暂不可用" : wallet.syncStatus === "unavailable" ? "暂不可用" : `${number(displayAllowance(wallet.availableCredits))} 额度`;
  return <ConsolePage title="任务看板" actions={<button className="ac-subtle" disabled={loading || !account} onClick={() => { setPending(true); setAttempt(value => value + 1); }}>{loading ? "同步中…" : "刷新记录 ↻"}</button>}>
    <div className="ac-dashboard-controls"><span className="ac-status">{account ? loading ? "正在同步" : "账户已连接" : "待登录"}</span><label>记录范围<select value={period} onChange={event => setPeriod(event.target.value)}><option value="all">全部时间</option><option value="1">最近 24 小时</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></label><Link className="ac-subtle" href="/studio">进入工作台 ↗</Link></div>
    <div className="ac-task-metrics">{[["running", "进行中", "正在执行的工作台任务"], ["complete", "已完成", "已交付的工作台任务"], ["queued", "排队中", "等待可用执行名额"], ["attention", "需处理", "待确认需求或执行异常"]].map(([tone, label, hint]) => <article key={tone}><p><i className={tone} />{label}</p><strong>—</strong><small>{hint}</small></article>)}</div>
    <p className="ac-note">运行状态与进度暂未同步，历史任务可在下方打开查看。</p>
    <div className="ac-dashboard-grid">
      <section className="ac-dashboard-card"><div className="ac-section-title"><h2>并发任务</h2><span className="ac-dim">使用中 / 可用上限</span></div><div className="ac-concurrency-value"><strong>— <span>/ —</span></strong><Link href="/account/pricing">查看会员 →</Link></div><div className="ac-capacity-track" aria-hidden="true" /><p className="ac-note">并发使用情况尚未同步。工作台并发名额不等同于 API 限流。</p><div className="ac-pending-line"><span className="ac-dim">任务记录</span><span>{loading ? "读取中…" : current?.error ? "暂不可用" : account ? `${current?.sessions.length ?? 0} 条` : "登录后查看"}</span></div></section>
      <section className="ac-dashboard-card ac-credit-card"><div className="ac-section-title"><h2>剩余额度</h2><Link href="/account/wallet">钱包 →</Link></div><dl><div><dt>会员当期剩余</dt><dd>{!account ? "—" : allowance?.status === "active" ? number(allowance.remainingUnits) : wallet ? "未开通" : loading ? "读取中…" : "暂不可用"}</dd></div><div><dt>账户余额</dt><dd>{balance}</dd></div><div><dt>每日体验</dt><dd>待开放</dd></div></dl><p className="ac-note">{current?.walletError || "工作台与 API 共用账户余额，实际权益以已开通方案为准。"}</p></section>
      <section className="ac-dashboard-card ac-token-card"><div className="ac-section-title"><h2>Token 消耗</h2><Link href="/account/logs">查看调用日志 →</Link></div><div className="ac-token-summary">{["总 Token", "输入 Token", "输出 Token"].map(label => <div key={label}><strong>—</strong><small>{label}</small></div>)}</div><div className="ac-chart-empty"><span>{account ? "用量趋势尚未汇总，可在调用日志中查看每次用量。" : "登录后查看调用用量"}</span></div><p className="ac-note">Token 表示模型用量，不等于扣减额度；图片、视频等按对应计费单位记录。</p></section>
    </div>
    <div className="ac-section-title"><h2>最近任务</h2><Link href="/studio">前往工作台 →</Link></div>
    <div className="reizo-task-search"><label>查找任务<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务名称或模型" /></label><span className="ac-note">{account && !loading && !current?.error ? `${visible.length} 条记录` : "登录后查看任务记录"}</span></div>
    <div className="ac-table-wrap"><table className="ac-table reizo-task-table"><thead><tr><th scope="col">任务</th><th scope="col">状态 / 进度</th><th scope="col">使用模型</th><th scope="col">更新时间</th></tr></thead><tbody>
      {loading || current?.error || !account || !visible.length ? <tr><td colSpan={4}><div className="ac-empty"><h3>{loading ? "正在同步任务…" : current?.error || (!account ? "登录后，任务在这里汇总" : "没有匹配的任务")}</h3><p>{!account ? "登录后查看历史任务与账户用量。" : "可以调整筛选条件，或前往工作台开始创作。"}</p>{!account ? <button className="ac-button" disabled={accountLoading} onClick={() => openLogin()}>登录账户 ↗</button> : current?.error ? <button className="ac-subtle" onClick={() => { setPending(true); setAttempt(value => value + 1); }}>重新同步</button> : <Link href="/studio">开始创作 ↗</Link>}</div></td></tr>
      : visible.map(session => <tr key={session.id}><td><Link href={`/studio?session=${encodeURIComponent(session.id)}`}>{session.title || "未命名任务"}</Link><small>打开工作台查看 →</small></td><td><span className="ac-status">待同步</span></td><td>{session.model || "—"}</td><td>{time(session.updatedAt)}</td></tr>)}
    </tbody></table></div>
  </ConsolePage>;
}
