import { getCurrentUserId } from "@/lib/auth/session";
import { NewApiTeamError } from "@/lib/newapi/team-client";
import { DEFAULT_QUOTA_PER_UNIT } from "@/lib/catalog/plaza-display";
import { workspaceGateway } from "@/lib/gateway/workspace";
import { membership } from "./plan-purchases";
import { getPlatformDb } from "@/lib/platform/db/client";
import {
  canManageOrganizationResources,
  getPlatformRepositories,
} from "@/lib/platform";
import type { OrganizationRole } from "@/lib/platform";
import type { ApiKeyRecord } from "@/lib/platform/repositories";
import type {
  ConsoleApiKey,
  ConsoleOrganizationUsageRollup,
  ConsoleOverview,
  ConsoleUsageByKey,
  ConsoleUsagePoint,
  ConsoleWalletDetails,
} from "./types";

export const MICROCREDITS_PER_CREDIT = BigInt(1_000_000);

export class ConsoleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export type ConsoleRequestContext = {
  userId: string;
  repositories: NonNullable<ReturnType<typeof getPlatformRepositories>>;
};

export function microcreditsToCredits(value: bigint): number {
  return Number(value) / Number(MICROCREDITS_PER_CREDIT);
}

export function creditsToMicrocredits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    throw new ConsoleRequestError("额度上限必须是有效的非负数字。", 400, "invalid_quota_limit");
  }
  return BigInt(Math.round(value * Number(MICROCREDITS_PER_CREDIT)));
}

export function consoleJson<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function consoleError(error: unknown): Response {
  if (error instanceof NewApiTeamError && error.status === 400) {
    return consoleJson({ error: error.message, code: "upstream_key_validation_failed" }, { status: 400 });
  }
  if (error instanceof NewApiTeamError && error.status === 409) {
    return consoleJson({ error: error.message, code: "team_routing_not_configured" }, { status: 409 });
  }
  if (error instanceof NewApiTeamError && error.status === 401) {
    return consoleJson({ error: "工作区的模型服务授权已失效，自动恢复未成功，请联系管理员修复工作区授权。", code: "team_authorization_failed" }, { status: 502 });
  }
  if (error instanceof ConsoleRequestError) {
    return consoleJson({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("Console request failed", error);
  return consoleJson({ error: "控制台请求未完成，请稍后重试。", code: "console_request_failed" }, { status: 500 });
}

/** Ensure the Auth.js identity has a local Reizo platform record. */
export async function requireConsoleContext(): Promise<ConsoleRequestContext> {
  const userId = await getCurrentUserId();
  if (!userId) throw new ConsoleRequestError("请先登录。", 401, "authentication_required");

  const repositories = getPlatformRepositories();
  if (!repositories) {
    throw new ConsoleRequestError("平台数据库尚未配置。", 503, "platform_not_configured");
  }

  const user = await repositories.users.findById(userId);
  if (!user || user.status !== "active") {
    throw new ConsoleRequestError("当前账户尚未迁移或不可用。", 403, "platform_account_unavailable");
  }
  return { userId, repositories };
}

export function mapConsoleApiKey(
  record: ApiKeyRecord,
  usedQuotaMicrocredits = BigInt(0),
  ownerName: string | null = null,
): ConsoleApiKey {
  const expired = Boolean(record.expiresAt && record.expiresAt.getTime() <= Date.now());
  return {
    id: record.id,
    name: record.name,
    prefix: record.keyPrefix,
    status: expired ? "expired" : record.status,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    // Per-key quota column was removed in the new-api cutover; balance lives on the team account.
    quotaLimit: null,
    usedQuota: microcreditsToCredits(usedQuotaMicrocredits),
    modelScopes: record.allowedModels,
    ipAllowList: record.ipAllowlist,
    organizationId: record.organizationId,
    ownerUserId: record.userId,
    ownerName,
  };
}

/**
 * Lists keys for a workspace. Callers must verify membership before passing
 * organizationId — this function does not re-check access.
 *
 * usedQuota is always 0 here: local usage_events were dropped; per-key usage
 * is served by GET /api/console/usage (new-api, Task 11).
 */
export async function listConsoleApiKeys(
  context: ConsoleRequestContext,
  organizationId?: string | null,
): Promise<ConsoleApiKey[]> {
  const records = organizationId
    ? await context.repositories.apiKeys.listForOrganization(organizationId)
    : await context.repositories.apiKeys.listForUser(context.userId);
  let ownerNames: Map<string, string> | null = null;
  if (organizationId) {
    const uniqueOwnerIds = [...new Set(records.map((record) => record.userId))];
    const owners = await Promise.all(uniqueOwnerIds.map((id) => context.repositories.users.findById(id)));
    ownerNames = new Map(
      owners
        .filter((owner): owner is NonNullable<typeof owner> => Boolean(owner))
        .map((owner) => [owner.id, owner.displayName]),
    );
  }
  return records
    .filter((record) => !record.isStudioHidden)
    .map((record) => mapConsoleApiKey(record, BigInt(0), ownerNames?.get(record.userId) ?? null))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * Legacy local usage_events breakdown — tables dropped in Task 3.
 * Prefer GET /api/console/usage (new-api). Kept as empty so old clients do not 500.
 */
export async function getConsoleUsageByKey(
  _context: ConsoleRequestContext,
  _organizationId?: string | null,
  _sinceDays = 14,
): Promise<ConsoleUsageByKey[]> {
  return [];
}

/**
 * Legacy org rollup over local usage_events — tables dropped in Task 3.
 * Prefer GET /api/console/usage (new-api).
 */
export async function getOrganizationUsageRollup(
  _context: ConsoleRequestContext,
  _organizationId: string,
  period?: { since?: Date; until?: Date },
): Promise<ConsoleOrganizationUsageRollup> {
  const now = new Date();
  const since = period?.since ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const until = period?.until ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart: since.toISOString(),
    periodEnd: until.toISOString(),
    totalRequests: 0,
    totalSettledCredits: 0,
    totalReservedCredits: 0,
    byKey: [],
  };
}

/** Same permission tier team.ts uses for member management (owner/admin), scoped to API keys. */
export function ensureOrganizationKeyManager(role: OrganizationRole): void {
  if (!canManageOrganizationResources(role)) {
    throw new ConsoleRequestError("只有工作区 owner 或 admin 可以管理工作区 API密钥。", 403, "organization_key_forbidden");
  }
}

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function lastUsageDays(days: number): ConsoleUsagePoint[] {
  const points: ConsoleUsagePoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - offset);
    points.push({ date: dayKey(day), credits: 0, requests: 0 });
  }
  return points;
}

const EMPTY_WALLET = {
  membershipAllowance: { status: "not_configured" as const },
  availableCredits: 0,
  reservedCredits: 0,
  usedCredits: 0,
  currency: "CNY",
  syncStatus: "unavailable" as "ready" | "unavailable",
  subscription: {
    name: "按量计费",
    status: "none" as const,
    renewsAt: null,
  },
};

async function walletFromCurrentOrganization(context: ConsoleRequestContext, targetOrganizationId?: string) {
  const user = await context.repositories.users.findById(context.userId);
  const organizationId = targetOrganizationId ?? user?.currentOrganizationId;
  if (!organizationId) return { ...EMPTY_WALLET };
  if (targetOrganizationId) {
    const membership = (await context.repositories.organizations.listMembershipsForUser(context.userId)).some(item => item.organizationId === targetOrganizationId);
    if (!membership) throw new ConsoleRequestError("你已不属于此工作区。", 403, "organization_forbidden");
  }
  const mapping = await context.repositories.teamNewApiMapping.findByOrganizationId(organizationId);
  if (!mapping) return { ...EMPTY_WALLET };
  try {
    const database = getPlatformDb();
    if (!database) return { ...EMPTY_WALLET };
    const { quota, usedQuota } = await workspaceGateway(database, organizationId).balance();
    const plan = await membership(context,organizationId);
    return {
      availableCredits: quota / DEFAULT_QUOTA_PER_UNIT,
      reservedCredits: 0,
      usedCredits: usedQuota / DEFAULT_QUOTA_PER_UNIT,
      currency: "CNY",
      syncStatus: "ready" as const,
      membershipAllowance: plan ? {status:"active" as const,totalUnits:String(plan.allowance),remainingUnits:String(Math.floor(plan.remainingAllowance)),periodStart:plan.startsAt,resetsAt:plan.expiresAt}:EMPTY_WALLET.membershipAllowance,
      subscription: plan ? {name:plan.name,status:"active" as const,renewsAt:plan.expiresAt}:EMPTY_WALLET.subscription,
    };
  } catch {
    return { ...EMPTY_WALLET };
  }
}

/**
 * Local wallet/ledger tables were dropped; remaining and used quota now
 * come from the workspace new-api account.
 */
export async function getConsoleWalletDetails(
  context: ConsoleRequestContext,
  organizationId?: string,
): Promise<ConsoleWalletDetails> {
  return {
    wallet: await walletFromCurrentOrganization(context, organizationId),
    ledger: [],
    paymentOrders: [],
  };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function getConsoleOverview(context: ConsoleRequestContext): Promise<ConsoleOverview> {
  const [memberships, keys, wallet, personalPersonalities, personalTools] = await Promise.all([
    context.repositories.organizations.listMembershipsForUser(context.userId),
    context.repositories.apiKeys.listForUser(context.userId),
    walletFromCurrentOrganization(context),
    context.repositories.presets.listPersonalities(context.userId),
    context.repositories.presets.listTools(context.userId),
  ]);

  const organizationMembership = memberships[0] ?? null;
  const organization = organizationMembership
    ? await context.repositories.organizations.findById(organizationMembership.organizationId)
    : null;

  const [members, orgPersonalities, orgTools] = organization
    ? await Promise.all([
        context.repositories.organizations.listMembers(organization.id),
        context.repositories.presets.listPersonalities(context.userId, organization.id),
        context.repositories.presets.listTools(context.userId, organization.id),
      ])
    : [[], [], []];

  const now = Date.now();
  const activeKeys = keys.filter((key) => key.status === "active" && (!key.expiresAt || key.expiresAt.getTime() > now));
  const expiringSoonKeys = activeKeys.filter((key) => key.expiresAt && key.expiresAt.getTime() <= now + THIRTY_DAYS_MS);
  const revokedKeys = keys.filter((key) => key.status === "revoked");

  const roleBreakdown: Record<OrganizationRole, number> = { owner: 0, admin: 0, member: 0, viewer: 0 };
  for (const member of members) roleBreakdown[member.role] += 1;

  const allPersonalities = [...personalPersonalities, ...orgPersonalities];
  const allTools = [...personalTools, ...orgTools];

  return {
    wallet,
    apiKeyCount: activeKeys.length,
    keys: {
      active: activeKeys.length,
      expiringSoon: expiringSoonKeys.length,
      revoked: revokedKeys.length,
    },
    team: organization
      ? { memberCount: members.length, roleBreakdown }
      : null,
    presets: {
      personalityCount: allPersonalities.length,
      toolCount: allTools.length,
      hasDefaultPersonality: allPersonalities.some((preset) => preset.isDefault),
      hasDefaultTool: allTools.some((preset) => preset.isDefault),
    },
    activeOrganization: organization && organizationMembership
      ? { id: organization.id, name: organization.name, role: organizationMembership.role }
      : null,
    usage: lastUsageDays(14),
    platformReady: true,
  };
}

function asConsoleStringList(raw: unknown, code: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    throw new ConsoleRequestError("列表字段格式无效。", 400, code);
  }
  return [...new Set(raw.map((entry) => entry.trim()).filter(Boolean))].slice(0, 100);
}

function parseConsoleKeyName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  // Capped at 50, not 120: new-api's AddToken rejects any token name over 50
  // chars (controller/token.go), and every virtual key is backed by a
  // new-api token 1:1 — a longer name here would fail key creation upstream.
  if (!name || name.length > 50) {
    throw new ConsoleRequestError("密钥名称必须为 1 到 50 个字符。", 400, "invalid_key_name");
  }
  return name;
}

function parseConsoleKeyExpiry(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new ConsoleRequestError("过期时间无效。", 400, "invalid_expiry");
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new ConsoleRequestError("过期时间必须晚于当前时间。", 400, "invalid_expiry");
  }
  return expiresAt;
}

export function parseConsoleKeyInput(value: unknown): {
  name: string;
  organizationId: string;
  expiresAt: Date | null;
  allowedModels: string[];
  ipAllowlist: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConsoleRequestError("请求内容无效。", 400, "invalid_request");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.organizationId !== "string" || !input.organizationId.trim()) {
    throw new ConsoleRequestError("创建 API密钥 需要指定工作区。", 400, "organization_id_required");
  }
  return {
    name: parseConsoleKeyName(input.name),
    organizationId: input.organizationId.trim(),
    expiresAt: parseConsoleKeyExpiry(input.expiresAt),
    allowedModels: asConsoleStringList(input.modelScopes, "invalid_model_scopes"),
    ipAllowlist: asConsoleStringList(input.ipAllowList, "invalid_ip_allowlist"),
  };
}

export function parseConsoleKeyPatchInput(value: unknown): {
  name: string;
  expiresAt: Date | null;
  allowedModels: string[];
  ipAllowlist: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConsoleRequestError("请求内容无效。", 400, "invalid_request");
  }
  const input = value as Record<string, unknown>;
  return {
    name: parseConsoleKeyName(input.name),
    expiresAt: parseConsoleKeyExpiry(input.expiresAt),
    allowedModels: asConsoleStringList(input.modelScopes, "invalid_model_scopes"),
    ipAllowlist: asConsoleStringList(input.ipAllowList, "invalid_ip_allowlist"),
  };
}

export type ConsoleEnterpriseBillingRequest = {
  id: string;
  organizationId: string;
  companyName: string;
  taxId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  estimatedMonthlySpendCredits: number | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Same permission tier as ensureOrganizationKeyManager (owner/admin), scoped to enterprise billing requests. */
export function ensureOrganizationBillingManager(role: OrganizationRole): void {
  if (!canManageOrganizationResources(role)) {
    throw new ConsoleRequestError("只有工作区 owner 或 admin 可以提交对公结算申请。", 403, "organization_billing_forbidden");
  }
}

export function parseEnterpriseBillingRequestInput(value: unknown): {
  companyName: string;
  taxId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  estimatedMonthlySpendCredits: number | null;
  notes: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConsoleRequestError("请求内容无效。", 400, "invalid_request");
  }
  const input = value as Record<string, unknown>;
  const companyName = typeof input.companyName === "string" ? input.companyName.trim() : "";
  if (!companyName || companyName.length > 200) {
    throw new ConsoleRequestError("公司名称必须为 1 到 200 个字符。", 400, "invalid_company_name");
  }
  const contactName = typeof input.contactName === "string" ? input.contactName.trim() : "";
  if (!contactName || contactName.length > 120) {
    throw new ConsoleRequestError("联系人姓名必须为 1 到 120 个字符。", 400, "invalid_contact_name");
  }
  const contactEmail = typeof input.contactEmail === "string" ? input.contactEmail.trim() : "";
  if (!contactEmail || contactEmail.length > 320 || !contactEmail.includes("@")) {
    throw new ConsoleRequestError("请输入有效的联系邮箱。", 400, "invalid_contact_email");
  }
  const optionalString = (raw: unknown, maxLength: number, code: string): string | null => {
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw !== "string" || raw.length > maxLength) {
      throw new ConsoleRequestError("字段格式无效。", 400, code);
    }
    return raw.trim() || null;
  };
  let estimatedMonthlySpendCredits: number | null = null;
  if (
    input.estimatedMonthlySpendCredits !== undefined &&
    input.estimatedMonthlySpendCredits !== null &&
    input.estimatedMonthlySpendCredits !== ""
  ) {
    const parsed =
      typeof input.estimatedMonthlySpendCredits === "number"
        ? input.estimatedMonthlySpendCredits
        : Number(input.estimatedMonthlySpendCredits);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ConsoleRequestError("预估月消耗必须是有效的非负数字。", 400, "invalid_estimated_spend");
    }
    estimatedMonthlySpendCredits = parsed;
  }
  return {
    companyName,
    taxId: optionalString(input.taxId, 64, "invalid_tax_id"),
    contactName,
    contactEmail,
    contactPhone: optionalString(input.contactPhone, 40, "invalid_contact_phone"),
    estimatedMonthlySpendCredits,
    notes: optionalString(input.notes, 4000, "invalid_notes"),
  };
}

/**
 * enterprise_billing_requests table was dropped with the billing engine.
 * Route retained so UI gets a clear 410 instead of a 500.
 */
export async function submitEnterpriseBillingRequest(
  _context: ConsoleRequestContext,
  _organizationId: string,
  _value: unknown,
): Promise<ConsoleEnterpriseBillingRequest> {
  throw new ConsoleRequestError(
    "对公结算已下线，请联系运营人工处理配额。",
    410,
    "enterprise_billing_retired",
  );
}

export async function getEnterpriseBillingRequestForOrg(
  context: ConsoleRequestContext,
  organizationId: string,
): Promise<ConsoleEnterpriseBillingRequest | null> {
  const membership = await context.repositories.organizations.getMembership(organizationId, context.userId);
  if (!membership) throw new ConsoleRequestError("你无权访问该工作区。", 403, "organization_forbidden");
  return null;
}
