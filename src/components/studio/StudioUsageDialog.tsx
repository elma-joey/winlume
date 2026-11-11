"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useModals } from "@/components/providers";
import { getConsoleWallet } from "@/lib/console/client";
import type { ConsoleWallet } from "@/lib/console/types";
import { remainingAllowancePercent } from "@/lib/billing/model";
import { displayAllowance } from "@/lib/billing/plans";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function StudioUsageDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { account } = useModals();
  return props.open && account ? <UsageDialogContent key={account.id} {...props} /> : null;
}

function UsageDialogContent({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [wallet, setWallet] = useState<ConsoleWallet | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void getConsoleWallet().then(({ wallet: next }) => {
      if (cancelled) return;
      if (next.syncStatus !== "ready") setError(true);
      else setWallet(next);
    }).catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);

  let remaining: number | null = null;
  if (wallet?.membershipAllowance) {
    try { remaining = remainingAllowancePercent(wallet.membershipAllowance); } catch { /* Invalid allowance is not a usable percentage. */ }
  }
  const used = remaining === null ? null : Math.round((100 - remaining) * 100) / 100;
  const money = (value: number) => `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(displayAllowance(value))} 额度`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-line bg-surface text-ink-900">
        <DialogHeader>
          <DialogTitle>额度用量</DialogTitle>
          <DialogDescription>查询当前工作区的账户余额与套餐额度。</DialogDescription>
        </DialogHeader>
        {loading ? <p role="status" className="py-6 text-sm text-ink-500">正在查询用量…</p> : error ? (
          <div role="alert" className="space-y-3 py-3"><p className="text-sm text-ink-500">暂时无法获取用量，请重试。</p><Button variant="outline" onClick={() => { setLoading(true); setError(false); setWallet(null); setRevision((value) => value + 1); }}>重新查询</Button></div>
        ) : wallet ? (
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-sm text-ink-500">可用余额</p><p className="mt-2 text-xl font-semibold">{money(wallet.availableCredits)}</p></div>
              <div><p className="text-sm text-ink-500">历史累计消费</p><p className="mt-2 text-xl font-semibold">{money(wallet.usedCredits)}</p></div>
            </div>
            {used !== null ? <div className="space-y-2">
              <div className="flex justify-between text-sm"><span>本期额度已用</span><strong>{used}%</strong></div>
              <div role="progressbar" aria-label="本期额度已用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-primary-500" style={{ width: `${used}%` }} /></div>
              <p className="text-xs text-ink-500">剩余 {remaining}%</p>
            </div> : <p className="rounded-lg bg-canvas p-3 text-sm text-ink-500">当前按量计费，未配置周期额度上限，暂无额度使用百分比。</p>}
            <Link href="/account/wallet" onClick={() => onOpenChange(false)} className="inline-block text-sm text-primary-500">查看钱包明细 →</Link>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
