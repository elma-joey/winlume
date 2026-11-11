export type ConsoleApiKey = {
  source?: "reizo" | "new-api";
  id: string;
  name: string;
  prefix: string;
  status: "active" | "disabled" | "revoked" | "expired";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  quotaLimit: number | null;
  usedQuota: number;
  modelScopes: string[];
  ipAllowList: string[];
  organizationId: string | null;
  ownerUserId: string;
  ownerName: string | null;
};

export type ConsoleWallet = {
  membershipAllowance?: import("../billing/model").MonthlyAllowance;
  syncStatus?: "ready" | "unavailable";
  availableCredits: number;
  reservedCredits: number;
  usedCredits: number;
  currency: string;
  subscription: {
    name: string;
    status: "active" | "inactive" | "none";
    renewsAt: string | null;
  };
};

export type ConsoleLedgerEntry = {
  id: string;
  type: string;
  amountCredits: number;
  reference: string | null;
  createdAt: string;
};

export type ConsolePaymentOrder = {
  id: string;
  reference: string;
  status: "pending" | "crediting" | "success" | "failed";
  amount: number;
  currency: string;
  credits: number;
  provider: string;
  paymentMethod: string;
  createdAt: string;
  paidAt: string | null;
};

export type ConsoleTopupMethod = {
  type: string;
  name: string;
};

export type ConsoleTopupConfig = {
  enabled: boolean;
  provider: "epay";
  currency: string;
  /** ¥1 = this many credits (fixed 1:1 with v2api today) */
  creditsPerUnit: number;
  topupDiscount?: number;
  minTopup: number;
  maxTopup?: number;
  amountOptions: number[];
  methods: ConsoleTopupMethod[];
};

export type ConsoleWalletDetails = {
  wallet: ConsoleWallet;
  ledger: ConsoleLedgerEntry[];
  paymentOrders: ConsolePaymentOrder[];
};

export type ConsoleUsagePoint = {
  date: string;
  credits: number;
  requests: number;
};

export type ConsoleUsageByKey = {
  apiKeyId: string;
  keyName: string;
  keyPrefix: string;
  ownerName: string | null;
  requests: number;
  settledCredits: number;
  reservedCredits: number;
};

export type ConsoleUsageModelSlice = {
  model: string;
  credits: number;
  requests: number;
};

export type ConsoleUsageCharts = {
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  daily: ConsoleUsagePoint[];
  byModel: ConsoleUsageModelSlice[];
};

export type ConsoleAccountUsageItem = {
  kind: "key" | "studio";
  apiKeyId: string;
  name: string;
  keyPrefix: string;
  totalGranted: number;
  totalUsed: number;
  totalAvailable: number;
};

export type ConsoleAccountUsage = {
  organizationId: string;
  quota: number;
  usedQuota: number;
  items: ConsoleAccountUsageItem[];
};

export type ConsoleUsageLogType = "consume" | "error" | "other";

export type ConsoleUsageLog = {
  id: string;
  createdAt: string;
  type: ConsoleUsageLogType;
  model: string;
  tokenName: string;
  promptTokens: number;
  completionTokens: number;
  durationSeconds: number;
  streamed: boolean;
  credits: number;
  requestId: string | null;
  content: string | null;
};

export type ConsoleOrganizationUsageRollup = {
  periodStart: string;
  periodEnd: string;
  totalRequests: number;
  totalSettledCredits: number;
  totalReservedCredits: number;
  byKey: ConsoleUsageByKey[];
};

export type ConsoleOverview = {
  wallet: ConsoleWallet;
  apiKeyCount: number;
  keys: {
    active: number;
    expiringSoon: number;
    revoked: number;
  };
  team: {
    memberCount: number;
    roleBreakdown: Record<ConsoleOrganizationRole, number>;
  } | null;
  presets: {
    personalityCount: number;
    toolCount: number;
    hasDefaultPersonality: boolean;
    hasDefaultTool: boolean;
  };
  activeOrganization: {
    id: string;
    name: string;
    role: "owner" | "admin" | "member" | "viewer";
  } | null;
  usage: ConsoleUsagePoint[];
  platformReady: boolean;
};

export type ConsoleApiErrorPayload = {
  error?: string;
  code?: string;
};

export type ConsoleOrganizationRole = "owner" | "admin" | "member" | "viewer";

export type ConsoleOrganization = {
  id: string;
  name: string;
  slug: string;
  role: ConsoleOrganizationRole;
};

export type ConsoleTeamMember = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  email: string | null;
  image: string | null;
  status: "active" | "suspended" | "pending";
  role: ConsoleOrganizationRole;
  joinedAt: string;
  isCurrentUser: boolean;
};

export type ConsoleTeam = {
  organizations: ConsoleOrganization[];
  organization: ConsoleOrganization;
  members: ConsoleTeamMember[];
  actorRole: ConsoleOrganizationRole;
  canManageMembers: boolean;
};

export type ConsolePresetCommon = {
  id: string;
  ownerUserId: string;
  organizationId: string | null;
  scope: "personal" | "organization";
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConsolePersonalityPreset = ConsolePresetCommon & {
  instructions: string;
};

export type ConsoleToolPreset = ConsolePresetCommon & {
  toolConfiguration: Record<string, unknown>;
};

export type ConsolePresetKind = "personality" | "tool";

export type ConsolePresets = {
  organizations: ConsoleOrganization[];
  activeOrganization: ConsoleOrganization | null;
  canManageOrganizationPresets: boolean;
  personalities: {
    personal: ConsolePersonalityPreset[];
    organization: ConsolePersonalityPreset[];
  };
  tools: {
    personal: ConsoleToolPreset[];
    organization: ConsoleToolPreset[];
  };
};
