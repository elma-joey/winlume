import type {
  ConsoleApiErrorPayload,
  ConsoleApiKey,
  ConsoleOrganization,
  ConsoleOrganizationUsageRollup,
  ConsoleAccountUsage,
  ConsoleOverview,
  ConsolePresetKind,
  ConsoleUsageCharts,
  ConsolePersonalityPreset,
  ConsolePresets,
  ConsoleTeam,
  ConsoleTeamMember,
  ConsoleToolPreset,
  ConsoleUsageByKey,
  ConsoleUsageLog,
  ConsolePaymentOrder,
  ConsoleTopupConfig,
  ConsoleWalletDetails,
} from "./types";

export class ConsoleClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) throw new ConsoleClientError("服务没有返回内容", response.status);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ConsoleClientError("服务返回了无法识别的数据", response.status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  if (!response.ok) {
    const error = await json<ConsoleApiErrorPayload>(response).catch(
      () => undefined,
    );
    throw new ConsoleClientError(
      error?.error || "请求未完成，请稍后重试。",
      response.status,
      error?.code,
    );
  }
  return json<T>(response);
}

export function getConsoleOverview() {
  return request<ConsoleOverview>("/api/console/overview", { cache: "no-store" });
}

export function getConsoleWallet() {
  return request<ConsoleWalletDetails>("/api/console/wallet", { cache: "no-store" });
}

export function redeemConsoleCode(input: { organizationId?: string | null; code: string }) {
  return request<{ organizationId: string; type: string; credits: number | null }>("/api/console/wallet/redeem", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type ConsoleTopupSnapshot = {
  organizationId: string | null;
  config: ConsoleTopupConfig;
  orders: ConsolePaymentOrder[];
  order: ConsolePaymentOrder | null;
};

export function getConsoleTopup(input?: { organizationId?: string | null; order?: string | null }) {
  const params = new URLSearchParams();
  if (input?.organizationId) params.set("organizationId", input.organizationId);
  if (input?.order) params.set("order", input.order);
  const search = params.toString();
  return request<ConsoleTopupSnapshot>(
    `/api/console/wallet/topup${search ? `?${search}` : ""}`,
    { cache: "no-store" },
  );
}

export function createConsoleTopup(input: {
  expectedPayMoney?: string;
  organizationId?: string | null;
  amount: number;
  paymentMethod: string;
}) {
  return request<{ tradeNo: string; url: string; params: Record<string, string> }>(
    "/api/console/wallet/topup",
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Submit the signed cashier form as a real navigation (top-level POST). */
export function submitEpayCashierForm(url: string, params: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  form.style.display = "none";
  for (const [key, value] of Object.entries(params)) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = key;
    field.value = value;
    form.appendChild(field);
  }
  document.body.appendChild(form);
  form.submit();
}

export function listConsoleKeys(organizationId?: string | null) {
  return request<{ keys: ConsoleApiKey[]; organizations: ConsoleOrganization[]; organizationId: string | null; syncWarning?: string; studioStatus: "ready" | "unavailable" | "missing" | "unknown" }>(
    `/api/console/keys${organizationQuery(organizationId)}`,
    { cache: "no-store" },
  );
}

export function importConsoleKeys(organizationId: string) {
  return request<{ imported: number }>("/api/console/keys/import", {
    method: "POST", body: JSON.stringify({ organizationId }),
  });
}

export function setConsoleKeyEnabled(id: string, enabled: boolean) {
  return request<{ key: ConsoleApiKey }>(`/api/console/keys/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ status: enabled ? "active" : "disabled" }),
  });
}

/** Lighter than listConsoleKeys: skips the key list and owner-name lookups when a page only needs the active workspace. */
export function getConsoleOrganizations(organizationId?: string | null) {
  return request<{ organizations: ConsoleOrganization[]; organizationId: string | null }>(
    `/api/console/organizations${organizationQuery(organizationId)}`,
    { cache: "no-store" },
  );
}

export function createConsoleKey(input: {
  name: string;
  organizationId?: string | null;
  expiresAt?: string | null;
  quotaLimit?: number | null;
  modelScopes?: string[];
  ipAllowList?: string[];
}) {
  return request<{ key: ConsoleApiKey; secret: string }>("/api/console/keys", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeConsoleKey(id: string) {
  return request<{ key: ConsoleApiKey }>(`/api/console/keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function updateConsoleKey(
  id: string,
  input: {
    name: string;
    expiresAt?: string | null;
    modelScopes?: string[];
    ipAllowList?: string[];
  },
) {
  return request<{ key: ConsoleApiKey }>(`/api/console/keys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getConsoleUsageLogs(
  organizationId?: string | null,
  query: {
    page?: number;
    pageSize?: number;
    type?: ConsoleUsageLog["type"];
    model?: string;
    tokenName?: string;
    requestId?: string;
  } = {},
) {
  const params = new URLSearchParams();
  if (organizationId) params.set("organizationId", organizationId);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.type && query.type !== "other") params.set("type", query.type);
  if (query.model) params.set("model", query.model);
  if (query.tokenName) params.set("tokenName", query.tokenName);
  if (query.requestId) params.set("requestId", query.requestId);
  const search = params.toString();
  return request<{ items: ConsoleUsageLog[]; total: number; page: number; pageSize: number }>(
    `/api/console/usage/logs${search ? `?${search}` : ""}`,
    { cache: "no-store" },
  );
}

export function getConsoleUsageCharts(organizationId?: string | null) {
  return request<ConsoleUsageCharts>(
    `/api/console/usage/charts${organizationQuery(organizationId)}`,
    { cache: "no-store" },
  );
}

export function getConsoleUsage(organizationId?: string | null) {
  return request<{
    organizationId: string;
    quota: number;
    used_quota: number;
    items: ConsoleAccountUsage["items"];
  }>(`/api/console/usage${organizationQuery(organizationId)}`, { cache: "no-store" }).then((payload) => ({
    organizationId: payload.organizationId,
    quota: payload.quota,
    usedQuota: payload.used_quota,
    items: payload.items,
  } satisfies ConsoleAccountUsage));
}

export function getConsoleUsageByKey(organizationId?: string | null) {
  return request<{ items: ConsoleUsageByKey[] }>(
    `/api/console/usage/by-key${organizationQuery(organizationId)}`,
    { cache: "no-store" },
  );
}

export function getConsoleOrganizationUsageRollup(organizationId: string) {
  return request<ConsoleOrganizationUsageRollup>(
    `/api/console/usage/rollup${organizationQuery(organizationId)}`,
    { cache: "no-store" },
  );
}

function organizationQuery(organizationId?: string | null): string {
  return organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
}

export function getConsoleTeam(organizationId?: string | null) {
  return request<ConsoleTeam>(`/api/console/team${organizationQuery(organizationId)}`, { cache: "no-store" });
}

export function addConsoleTeamMember(input: {
  organizationId?: string | null;
  identifier: string;
  role: ConsoleTeamMember["role"];
}) {
  return request<{ member: ConsoleTeamMember }>("/api/console/team", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateConsoleTeamMember(
  userId: string,
  input: { organizationId?: string | null; role: ConsoleTeamMember["role"] },
) {
  return request<{ member: ConsoleTeamMember }>(`/api/console/team/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function removeConsoleTeamMember(userId: string, organizationId?: string | null) {
  return request<{ ok: true }>(`/api/console/team/${encodeURIComponent(userId)}${organizationQuery(organizationId)}`, {
    method: "DELETE",
  });
}

export function getConsolePresets(organizationId?: string | null) {
  return request<ConsolePresets>(`/api/console/presets${organizationQuery(organizationId)}`, { cache: "no-store" });
}

export function createConsolePreset(input: {
  kind: ConsolePresetKind;
  scope: "personal" | "organization";
  organizationId?: string | null;
  name: string;
  description?: string | null;
  instructions?: string;
  toolConfiguration?: Record<string, unknown>;
  isDefault?: boolean;
}) {
  return request<{ kind: ConsolePresetKind; preset: ConsolePersonalityPreset | ConsoleToolPreset }>("/api/console/presets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateConsolePreset(
  kind: ConsolePresetKind,
  id: string,
  input: {
    name?: string;
    description?: string | null;
    instructions?: string;
    toolConfiguration?: Record<string, unknown>;
    isDefault?: boolean;
  },
) {
  return request<{ preset: ConsolePersonalityPreset | ConsoleToolPreset }>(
    `/api/console/presets/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function setConsolePresetDefault(kind: ConsolePresetKind, id: string) {
  return request<{ preset: ConsolePersonalityPreset | ConsoleToolPreset }>(
    `/api/console/presets/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/default`,
    { method: "POST" },
  );
}

export function removeConsolePreset(kind: ConsolePresetKind, id: string) {
  return request<{ ok: true }>(`/api/console/presets/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
