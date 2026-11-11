"use client";
import { displayAllowance } from "@/lib/billing/plans";

import Link from "next/link";
import { ArrowUpRight, CreditCard, Ticket } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleUsageCharts } from "@/components/account/ConsoleUsageCharts";
import { ConsoleEmptyState, ConsolePage } from "@/components/console/ConsolePage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DEFAULT_QUOTA_PER_UNIT } from "@/lib/catalog/plaza-display";
import {
  createConsoleTopup,
  getConsoleOrganizations,
  getConsoleOverview,
  getConsoleTopup,
  getConsoleUsage,
  getConsoleUsageCharts,
  redeemConsoleCode,
  submitEpayCashierForm,
  type ConsoleTopupSnapshot,
} from "@/lib/console/client";
import type {
  ConsoleAccountUsage,
  ConsoleOrganization,
  ConsoleOverview,
  ConsolePaymentOrder,
  ConsoleUsageCharts as ConsoleUsageChartsData,
} from "@/lib/console/types";

function amount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function creditsFromQuota(quota: number) {
  return quota / DEFAULT_QUOTA_PER_UNIT;
}

const ORDER_STATUS: Record<
  ConsolePaymentOrder["status"],
  { label: string; variant: "secondary" | "success" | "destructive" }
> = {
  pending: { label: "待支付", variant: "secondary" },
  crediting: { label: "到账中", variant: "secondary" },
  success: { label: "已到账", variant: "success" },
  failed: { label: "已失败", variant: "destructive" },
};

function formatOrderTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AccountWalletContent() {
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [organizations, setOrganizations] = useState<ConsoleOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [accountUsage, setAccountUsage] = useState<ConsoleAccountUsage | null>(null);
  const [charts, setCharts] = useState<ConsoleUsageChartsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemMessage, setRedeemMessage] = useState<string | null>(null);

  const [topup, setTopup] = useState<ConsoleTopupSnapshot | null>(null);
  // 0 / "" mean "fall back to the first configured option", resolved at render.
  const [topupAmount, setTopupAmount] = useState<number>(0);
  const [topupCustom, setTopupCustom] = useState("");
  const [topupMethod, setTopupMethod] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);

  // The cashier redirects back with `?order=<tradeNo>`; capture it once at mount.
  const [returnRef] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("order");
  });
  const [returnOrder, setReturnOrder] = useState<ConsolePaymentOrder | null>(null);

  const loadWorkspace = useCallback(async () => {
    setError(null);
    try {
      const [overviewResult, orgsResult] = await Promise.all([
        getConsoleOverview(),
        getConsoleOrganizations(),
      ]);
      setOverview(overviewResult);
      setOrganizations(orgsResult.organizations);
      setOrganizationId((current) => {
        if (current) return current;
        return orgsResult.organizationId ?? overviewResult.activeOrganization?.id ?? orgsResult.organizations[0]?.id ?? null;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载钱包。");
    } finally {
      setWorkspaceReady(true);
    }
  }, []);

  const loadUsage = useCallback(async (targetOrganizationId: string | null) => {
    if (!targetOrganizationId) {
      setAccountUsage(null);
      setCharts(null);
      setUsageError(null);
      return;
    }
    setUsageError(null);
    try {
      const [usageResult, chartsResult] = await Promise.all([
        getConsoleUsage(targetOrganizationId),
        getConsoleUsageCharts(targetOrganizationId),
      ]);
      setAccountUsage(usageResult);
      setCharts(chartsResult);
    } catch (reason) {
      setAccountUsage(null);
      setCharts(null);
      setUsageError(reason instanceof Error ? reason.message : "无法加载用量。");
    }
  }, []);

  const loadTopup = useCallback(async (targetOrganizationId: string | null) => {
    try {
      const snapshot = await getConsoleTopup({ organizationId: targetOrganizationId });
      setTopup(snapshot);
    } catch {
      setTopup(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkspace(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!workspaceReady) return;
    const timer = window.setTimeout(() => {
      void loadUsage(organizationId);
      void loadTopup(organizationId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceReady, organizationId, loadUsage, loadTopup]);

  // Strip `?order=` from the address bar so a refresh does not re-run the
  // confirmation flow. Pure DOM/history side effect — no React state here.
  useEffect(() => {
    if (!returnRef) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("order")) return;
    url.searchParams.delete("order");
    window.history.replaceState(null, "", url.toString());
  }, [returnRef]);

  // Poll the returned order until the webhook settles it (return_url can beat
  // the async notify). Crediting happens server-side; this only reflects it.
  useEffect(() => {
    if (!returnRef || !organizationId) return;
    let active = true;
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const snapshot = await getConsoleTopup({ organizationId, order: returnRef });
        if (!active) return;
        setReturnOrder(snapshot.order);
        if (snapshot.order && (snapshot.order.status === "success" || snapshot.order.status === "failed")) {
          if (snapshot.order.status === "success") {
            void loadWorkspace();
            void loadUsage(organizationId);
            void loadTopup(organizationId);
          }
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (active && attempts < 15) window.setTimeout(tick, 2500);
    };
    void tick();
    return () => { active = false; };
  }, [returnRef, organizationId, loadWorkspace, loadUsage, loadTopup]);

  const activeOrganization = organizationId
    ? organizations.find((organization) => organization.id === organizationId) ?? null
    : overview?.activeOrganization ?? null;
  const canManageWallet = activeOrganization?.role === "owner" || activeOrganization?.role === "admin";
  const allowance = overview?.wallet.membershipAllowance ?? { status: "not_configured" as const };
  const available = accountUsage
    ? creditsFromQuota(accountUsage.quota)
    : overview?.wallet.availableCredits ?? 0;
  const used = accountUsage
    ? creditsFromQuota(accountUsage.usedQuota)
    : overview?.wallet.usedCredits ?? 0;

  const topupConfig = topup?.config ?? null;
  const orders = topup?.orders ?? [];

  // Derive the effective selection during render so no effect has to sync it.
  const selectedMethod = topupMethod || topupConfig?.methods[0]?.type || "";
  const presetAmount = topupAmount || topupConfig?.amountOptions[0] || topupConfig?.minTopup || 0;
  const customAmount = topupCustom.trim() === "" ? null : Number(topupCustom);
  const customInvalid =
    customAmount !== null &&
    (!Number.isInteger(customAmount) || customAmount < (topupConfig?.minTopup ?? 1));
  const effectiveAmount = customAmount !== null && !customInvalid ? customAmount : presetAmount;
  const payable = (Math.round(effectiveAmount*100*(topupConfig?.topupDiscount??1))/100).toFixed(2);
  const canPay =
    Boolean(topupConfig?.enabled) &&
    canManageWallet &&
    Boolean(organizationId) &&
    Boolean(selectedMethod) &&
    effectiveAmount > 0 &&
    !customInvalid;

  const returnBanner = useMemo(() => {
    if (!returnRef) return null;
    if (!returnOrder) return { tone: "info" as const, text: "正在确认支付结果…" };
    if (returnOrder.status === "success") {
      return { tone: "info" as const, text: `充值成功，${amount(displayAllowance(returnOrder.credits))} 额度已到账。` };
    }
    if (returnOrder.status === "failed") {
      return { tone: "error" as const, text: "本次支付未完成或已失败；如果已经扣款，请联系客服核对。" };
    }
    return { tone: "info" as const, text: "支付处理中，到账后余额会自动刷新…" };
  }, [returnRef, returnOrder]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim();
    if (!normalized) {
      setRedeemError("请输入兑换码。");
      return;
    }
    setRedeeming(true);
    setRedeemError(null);
    setRedeemMessage(null);
    try {
      const result = await redeemConsoleCode({
        organizationId,
        code: normalized,
      });
      setCode("");
      setRedeemMessage(result.credits != null ? `兑换成功，已到账 ${amount(displayAllowance(result.credits))} 额度。` : "兑换成功。");
      await Promise.all([loadWorkspace(), loadUsage(organizationId), loadTopup(organizationId)]);
    } catch (reason) {
      setRedeemError(reason instanceof Error ? reason.message : "兑换失败，请稍后重试。");
    } finally {
      setRedeeming(false);
    }
  }

  async function startTopup() {
    if (!organizationId || !canPay) return;
    setTopupError(null);
    setCreatingOrder(true);
    try {
      const { url, params } = await createConsoleTopup({
        organizationId,
        amount: effectiveAmount,
        expectedPayMoney: payable,
        paymentMethod: selectedMethod,
      });
      // Full-page navigation to the cashier; state is left as-is on purpose.
      submitEpayCashierForm(url, params);
    } catch (reason) {
      setTopupError(reason instanceof Error ? reason.message : "发起支付失败，请稍后重试。");
      setCreatingOrder(false);
    }
  }

  return (
    <ConsolePage
      title="钱包与账单"
    >
      {organizations.length > 1 && organizationId ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>工作区</span>
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger aria-label="选择工作区" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {returnBanner ? (
        <Alert className="mb-4" variant={returnBanner.tone === "error" ? "destructive" : undefined}>
          <AlertDescription>{returnBanner.text}</AlertDescription>
        </Alert>
      ) : null}

      {!overview && !error ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner /> 正在加载钱包与充值信息…
        </div>
      ) : null}
      {error ? <ConsoleEmptyState title="钱包暂不可用" description={error} /> : null}

      {overview ? (
        <div className="space-y-6">
          <div className="ac-balances ac-balances-main">
            <article><p>会员月度额度 <span>当期权益</span></p><strong>{allowance.status === "active" ? amount(Number(allowance.remainingUnits)) : "未开通"}</strong><small>{allowance.status === "active" ? `重置日期：${new Date(allowance.resetsAt).toLocaleDateString("zh-CN")}` : "已开通权益以账户实际配置为准"}</small></article>
            <article><p>账户余额 <span>工作台与 API 共用</span></p><strong>{!accountUsage && overview.wallet.syncStatus === "unavailable" ? "暂不可用" : amount(displayAllowance(available))}</strong><small>{overview.wallet.currency} · 按实际模型用量计费</small></article>
          </div>
          <p className="ac-note">累计已用：{!accountUsage && overview.wallet.syncStatus === "unavailable" ? "暂不可用" : amount(displayAllowance(used))} · 以当前工作区实际消费为准</p>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card>
              <CardHeader>
                <CardTitle>在线充值</CardTitle>
                <CardDescription>
                  {topupConfig?.enabled
                    ? "支付成功后额度自动到账当前工作区，1 元 = 1 额度。"
                    : "在线充值尚未开通，可先使用兑换码。"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topupConfig?.enabled ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">充值金额（元）</span>
                      <div className="flex flex-wrap gap-2">
                        {topupConfig.amountOptions.map((option) => {
                          const active = customAmount === null && presetAmount === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setTopupAmount(option);
                                setTopupCustom("");
                              }}
                              className={cn(
                                "min-w-16 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                                active
                                  ? "border-primary-500 bg-primary-500 text-white"
                                  : "border-line text-ink-700 hover:border-primary-400",
                              )}
                            >
                              ¥{option}
                            </button>
                          );
                        })}
                      </div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={topupConfig.minTopup}
                        step={1}
                        value={topupCustom}
                        onChange={(event) => setTopupCustom(event.target.value)}
                        placeholder={`其它金额（最低 ¥${topupConfig.minTopup}）`}
                        className="max-w-xs"
                      />
                      {customInvalid ? (
                        <FieldError>请输入不小于 {topupConfig.minTopup} 的整数金额。</FieldError>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">支付方式</span>
                      <div className="flex flex-wrap gap-2">
                        {topupConfig.methods.map((method) => (
                          <button
                            key={method.type}
                            type="button"
                            onClick={() => setTopupMethod(method.type)}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                              selectedMethod === method.type
                                ? "border-primary-500 bg-primary-500 text-white"
                                : "border-line text-ink-700 hover:border-primary-400",
                            )}
                          >
                            {method.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <FieldDescription>
                      {!organizationId
                        ? "选择工作区后才能充值。"
                        : canManageWallet
                          ? `到账工作区：${activeOrganization?.name}　·　约 ${amount(displayAllowance(effectiveAmount))} 额度`
                          : "只有工作区 owner 或 admin 可以充值。"}
                    </FieldDescription>

                    {topupError ? <FieldError>{topupError}</FieldError> : null}

                    <Button type="button" onClick={startTopup} disabled={!canPay || creatingOrder}>
                      {creatingOrder ? <Spinner data-icon="inline-start" /> : <CreditCard data-icon="inline-start" />}
                      去支付 ¥{payable}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    在线支付暂未开放，可以使用已有兑换码，或联系支持了解充值方式。
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>兑换码</CardTitle>
                <CardDescription>充入当前工作区额度账户。</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={redeem} className="flex flex-col gap-3">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="redeem-code">兑换码</FieldLabel>
                      <Input
                        id="redeem-code"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        placeholder="输入兑换码"
                        autoComplete="off"
                        maxLength={128}
                      />
                      <FieldDescription>
                        {!organizationId
                          ? "选择工作区后才能兑换。"
                          : canManageWallet
                            ? `当前工作区：${activeOrganization?.name}`
                            : "只有工作区 owner 或 admin 可以兑换。"}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                  {redeemError ? <FieldError>{redeemError}</FieldError> : null}
                  {redeemMessage ? (
                    <Alert>
                      <AlertDescription>{redeemMessage}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button type="submit" disabled={redeeming || !canManageWallet || !organizationId}>
                    {redeeming ? <Spinner data-icon="inline-start" /> : <Ticket data-icon="inline-start" />}
                    兑换
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {usageError ? (
            <Alert variant="destructive">
              <AlertDescription>{usageError}</AlertDescription>
            </Alert>
          ) : null}

          {!organizationId ? (
            <ConsoleEmptyState title="还没有工作区" description="余额和消耗记在工作区额度账户上。被邀请加入后会出现在这里。" />
          ) : (
            <>
              <ConsoleUsageCharts charts={charts} keys={accountUsage?.items ?? []} />

              {orders.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>充值记录</CardTitle>
                    <CardDescription>最近 {orders.length} 笔在线充值订单。</CardDescription>
                  </CardHeader>
                  <CardContent className="px-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>时间</TableHead>
                            <TableHead>金额</TableHead>
                            <TableHead>额度</TableHead>
                            <TableHead>方式</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead>订单号</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {orders.map((order) => {
                            const status = ORDER_STATUS[order.status];
                            return (
                              <TableRow key={order.id}>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                  {formatOrderTime(order.createdAt)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  ¥{amount(order.amount)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">{amount(displayAllowance(order.credits))}</TableCell>
                                <TableCell className="whitespace-nowrap">{order.paymentMethod}</TableCell>
                                <TableCell>
                                  <Badge variant={status.variant}>{status.label}</Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {order.reference}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <div className="flex justify-end gap-4">
                <Link href="/account/usage" className="inline-flex items-center gap-1 text-sm font-medium text-ink-700 hover:text-ink-950">
                  消费记录 <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <Link href="/account/logs" className="inline-flex items-center gap-1 text-sm font-medium text-ink-700 hover:text-ink-950">
                  查看请求日志 <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          )}
        </div>
      ) : null}
    </ConsolePage>
  );
}
