/** Reizo owns entitlements; a missing plan must never imply zero or unlimited. */
export type MonthlyAllowance =
  | { status: "not_configured" }
  | { status: "active"; totalUnits: string; remainingUnits: string; periodStart: string; resetsAt: string };

export type BillingConfiguration = {
  settlementMode: "legacy_balance" | "reizo";
  allowBalanceFallback: boolean;
  monthlyPlan: null | {
    code: string;
    totalUnits: string;
    rateVersion: string;
    cycle: "subscription_month" | "calendar_month";
    timezone: string;
    carryOver: boolean;
  };
};

export const INITIAL_BILLING_CONFIGURATION: BillingConfiguration = {
  settlementMode: "legacy_balance",
  allowBalanceFallback: true,
  monthlyPlan: null,
};

/** Integer accounting keeps a percentage a display value, not a billing unit. */
export function remainingAllowancePercent(allowance: MonthlyAllowance): number | null {
  if (allowance.status !== "active") return null;
  if (!/^\d+$/.test(allowance.totalUnits) || !/^\d+$/.test(allowance.remainingUnits)) throw new Error("Invalid allowance units");
  const total = BigInt(allowance.totalUnits), remaining = BigInt(allowance.remainingUnits);
  if (total <= BigInt(0) || remaining > total) throw new Error("Invalid allowance balance");
  return Number(remaining * BigInt(10000) / total) / 100;
}
