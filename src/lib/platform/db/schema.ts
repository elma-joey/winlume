import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "pending"]);
export const platformRoleEnum = pgEnum("platform_role", ["user", "admin"]);
export const organizationRoleEnum = pgEnum("organization_role", ["owner", "admin", "member", "viewer"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "disabled", "revoked"]);
export const presetScopeEnum = pgEnum("preset_scope", ["personal", "organization"]);
export const skillSourceEnum = pgEnum("skill_source", ["bundled", "imported", "user"]);
export const feedbackTypeEnum = pgEnum("feedback_type", ["bug", "feature"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["open", "resolved"]);
export const epayOrderStatusEnum = pgEnum("epay_order_status", [
  "pending",
  "crediting",
  "success",
  "failed",
]);

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyNewApiUserId: integer("legacy_new_api_user_id").unique(),
    username: varchar("username", { length: 64 }).notNull(),
    email: varchar("email", { length: 320 }).unique(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    image: text("image"),
    passwordHash: varchar("password_hash", { length: 255 }),
    status: userStatusEnum("status").default("active").notNull(),
    platformRole: platformRoleEnum("platform_role").default("user").notNull(),
    isServiceAccount: boolean("is_service_account").default(false).notNull(),
    // Lazy FK to organizations (defined below) — AnyPgColumn breaks the circular type inference.
    currentOrganizationId: uuid("current_organization_id").references((): AnyPgColumn => organizations.id, {
      onDelete: "set null",
    }),
    authVersion: integer("auth_version").default(1).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    index("users_status_index").on(table.status),
  ],
);

// Desktop credentials are independent of browser cookies; only their hashes are stored.
export const desktopSessions = pgTable("desktop_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  authVersion: integer("auth_version"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("desktop_sessions_expires_index").on(table.expiresAt)]);

export const emailChanges = pgTable("email_changes", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  id: uuid("id").defaultRandom().notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  previousEmail: varchar("previous_email", { length: 320 }),
  authVersion: integer("auth_version").notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  previousCodeHash: varchar("previous_code_hash", { length: 64 }),
  attempts: integer("attempts").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authChallengePurposeEnum = pgEnum("auth_challenge_purpose", ["signup", "password_reset"]);

export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purpose: authChallengePurposeEnum("purpose").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    username: varchar("username", { length: 64 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt,
  },
  (table) => [
    index("auth_challenges_email_purpose_index").on(table.email, table.purpose),
    index("auth_challenges_expires_index").on(table.expiresAt),
  ],
);

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("auth_identities_provider_account_unique").on(table.provider, table.providerAccountId),
    index("auth_identities_user_index").on(table.userId),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("organizations_slug_unique").on(table.slug),
    index("organizations_created_by_user_index").on(table.createdByUserId),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").default("member").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("organization_memberships_organization_user_unique").on(table.organizationId, table.userId),
    index("organization_memberships_user_index").on(table.userId),
  ],
);

export const teamNewApiMapping = pgTable(
  "team_new_api_mapping",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    newApiUserId: integer("new_api_user_id").notNull(),
    newApiUsername: varchar("new_api_username", { length: 64 }).notNull(),
    newApiPasswordCiphertext: text("new_api_password_ciphertext").notNull(),
    newApiPatCiphertext: text("new_api_pat_ciphertext").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("team_new_api_mapping_user_id_unique").on(table.newApiUserId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    name: varchar("name", { length: 120 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 32 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    status: apiKeyStatusEnum("status").default("active").notNull(),
    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    allowedModels: text("allowed_models").array().notNull().default(sql`ARRAY[]::text[]`),
    allowedGroups: text("allowed_groups").array().notNull().default(sql`ARRAY[]::text[]`),
    ipAllowlist: text("ip_allowlist").array().notNull().default(sql`ARRAY[]::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    newApiTokenId: integer("new_api_token_id"),
    newApiKeyCiphertext: text("new_api_key_ciphertext"),
    isStudioHidden: boolean("is_studio_hidden").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_unique").on(table.keyHash),
    index("api_keys_user_index").on(table.userId),
    index("api_keys_organization_index").on(table.organizationId),
    index("api_keys_prefix_index").on(table.keyPrefix),
  ],
);

export const personalityPresets = pgTable(
  "personality_presets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    scope: presetScopeEnum("scope").default("personal").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("personality_presets_owner_index").on(table.ownerUserId),
    index("personality_presets_organization_index").on(table.organizationId),
    uniqueIndex("personality_presets_personal_default_unique")
      .on(table.ownerUserId)
      .where(sql`${table.isDefault} = true AND ${table.scope} = 'personal'`),
    uniqueIndex("personality_presets_organization_default_unique")
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true AND ${table.scope} = 'organization'`),
    check(
      "personality_presets_scope_organization_check",
      sql`(${table.scope} = 'personal' AND ${table.organizationId} IS NULL) OR (${table.scope} = 'organization' AND ${table.organizationId} IS NOT NULL)`,
    ),
  ],
);

export const toolPresets = pgTable(
  "tool_presets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    scope: presetScopeEnum("scope").default("personal").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    toolConfiguration: jsonb("tool_configuration").$type<Record<string, unknown>>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("tool_presets_owner_index").on(table.ownerUserId),
    index("tool_presets_organization_index").on(table.organizationId),
    uniqueIndex("tool_presets_personal_default_unique")
      .on(table.ownerUserId)
      .where(sql`${table.isDefault} = true AND ${table.scope} = 'personal'`),
    uniqueIndex("tool_presets_organization_default_unique")
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true AND ${table.scope} = 'organization'`),
    check(
      "tool_presets_scope_organization_check",
      sql`(${table.scope} = 'personal' AND ${table.organizationId} IS NULL) OR (${table.scope} = 'organization' AND ${table.organizationId} IS NOT NULL)`,
    ),
  ],
);

export const studioSkills = pgTable(
  "studio_skills",
  {
    id: varchar("id", { length: 120 }).primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    category: varchar("category", { length: 80 }).notNull().default("general"),
    triggers: text("triggers").array().notNull().default(sql`ARRAY[]::text[]`),
    examplePrompt: text("example_prompt"),
    preview: varchar("preview", { length: 20 }),
    source: skillSourceEnum("source").notNull().default("bundled"),
    enabled: boolean("enabled").notNull().default(true),
    featured: boolean("featured").notNull().default(false),
    defaultArtifact: varchar("default_artifact", { length: 32 }),
    systemPrompt: text("system_prompt").notNull().default(""),
    origin: varchar("origin", { length: 80 }),
    originPath: text("origin_path"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("studio_skills_category_index").on(table.category),
    index("studio_skills_source_index").on(table.source),
    index("studio_skills_enabled_index").on(table.enabled),
  ],
);

export const feedbackReports = pgTable(
  "feedback_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: feedbackTypeEnum("type").notNull(),
    description: text("description").notNull(),
    screenshots: jsonb("screenshots").$type<string[]>().notNull().default([]),
    status: feedbackStatusEnum("status").default("open").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("feedback_reports_user_index").on(table.userId),
    index("feedback_reports_status_index").on(table.status),
  ],
);

/**
 * 易支付 (kyren / 启润) online top-up orders. This table is a payment audit
 * trail and idempotency guard only — it is NOT the balance. The single source
 * of truth for a workspace's balance stays the mapped new-api user's quota;
 * a settled order credits that quota via the new-api admin API.
 *
 * `amountCredits` == CNY paid at the fixed 1:1 rate (¥1 = 1 credit = 500_000
 * quota). `payMoney` is the exact `money` string signed into the purchase
 * request and must be reused verbatim if the request is ever rebuilt.
 */
export const epayOrders = pgTable(
  "epay_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tradeNo: varchar("trade_no", { length: 64 }).notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    newApiUserId: integer("new_api_user_id").notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("epay"),
    paymentMethod: varchar("payment_method", { length: 32 }).notNull(),
    amountCredits: integer("amount_credits").notNull(),
    payMoney: varchar("pay_money", { length: 32 }).notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("CNY"),
    status: epayOrderStatusEnum("status").notNull().default("pending"),
    epayTradeNo: varchar("epay_trade_no", { length: 128 }),
    quotaGranted: integer("quota_granted"),
    notifyPayload: jsonb("notify_payload").$type<Record<string, unknown>>(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("epay_orders_trade_no_unique").on(table.tradeNo),
    index("epay_orders_organization_index").on(table.organizationId),
    index("epay_orders_user_index").on(table.userId),
    index("epay_orders_status_index").on(table.status),
  ],
);

/** Platform-managed content consumed by public portal surfaces. */
export const portalContentSettings = pgTable(
  "portal_content_settings",
  {
    key: varchar("key", { length: 80 }).primaryKey(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
);

/** Private service credentials. Never included in the public portal settings. */
export const serviceIntegrations = pgTable("service_integrations", {
  id: varchar("id", { length: 40 }).primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt,
});

/** Purchase audit only; entitlement and deduction remain in the model gateway. */
export const planPurchases = pgTable("reizo_plan_purchases", {
  id: varchar("id", { length: 64 }).primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  planId: varchar("plan_id", { length: 20 }).notNull(),
  productId: varchar("product_id", { length: 128 }).notNull(),
  nativePlanId: integer("native_plan_id").notNull(),
  amount: varchar("amount", { length: 32 }).notNull(),
  allowance: integer("allowance").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("creating"),
  nativeReference: varchar("native_reference", { length: 128 }),
  checkoutId: varchar("checkout_id", { length: 128 }),
  checkoutUrl: text("checkout_url"),
  checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }),
  providerOrderId: varchar("provider_order_id", { length: 128 }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt, updatedAt,
}, table => [uniqueIndex("reizo_plan_native_reference").on(table.nativeReference), uniqueIndex("reizo_plan_checkout").on(table.checkoutId), uniqueIndex("reizo_plan_provider_order").on(table.providerOrderId), index("reizo_plan_org").on(table.organizationId), uniqueIndex("reizo_plan_one_pending_per_org").on(table.organizationId).where(sql`${table.status} in ('creating','pending','uncertain')`)]);

export const kyrenEvents = pgTable("reizo_kyren_events", {
  id: varchar("id", { length: 128 }).primaryKey(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  type: varchar("type", { length: 80 }).notNull(),
  purchaseId: varchar("purchase_id", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  createdAt, updatedAt,
});
