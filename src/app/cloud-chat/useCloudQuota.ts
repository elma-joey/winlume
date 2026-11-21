"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayAllowance } from "@/lib/billing/plans";
import { getConsoleWallet } from "@/lib/console/client";

export function useCloudQuota() {
  const [quota, setQuota] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const retries = useRef<number[]>([]);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
    retries.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 10000);
    try {
      const { wallet } = await getConsoleWallet(controller.signal);
      if (request.current !== controller || wallet.syncStatus !== "ready") return;
      const allowance = wallet.membershipAllowance;
      const plan = allowance?.status === "active" ? Number(allowance.remainingUnits) : 0;
      setQuota(Math.max(0, displayAllowance(wallet.availableCredits)) + (Number.isFinite(plan) ? Math.max(0, plan) : 0));
    } catch {
      // Keep the last confirmed balance until the next read succeeds.
    } finally {
      window.clearTimeout(deadline);
      if (request.current === controller) request.current = null;
    }
  }, []);

  const refreshAfterUse = useCallback(() => {
    retries.current.forEach((timer) => window.clearTimeout(timer));
    void refresh();
    // Upstream may settle usage after the last chat or artifact event.
    retries.current = [1500, 4500].map((delay) => window.setTimeout(refresh, delay));
  }, [refresh]);

  return { quota, refresh, refreshAfterUse };
}
