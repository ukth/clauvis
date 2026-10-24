import { pgTable, uuid, text, timestamp, pgEnum, unique, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const priorityEnum = pgEnum("priority", ["urgent", "normal", "low"]);
export const statusEnum = pgEnum("status", ["pending", "done"]);
export const sourceEnum = pgEnum("source", ["telegram", "web", "mcp"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  telegramChatId: text("telegram_chat_id").unique(),
  encryptedAnthropicKey: text("encrypted_anthropic_key"),
  model: text("model").notNull().default("sonnet"),
  ledgerSyncedAt: timestamp("ledger_synced_at", { withTimezone: true }),
  // Last issued transaction #number; numbers are reserved atomically by incrementing this
  ledgerSeq: integer("ledger_seq").notNull().default(0),
  // KST date (YYYY-MM-DD) of the last daily ledger digest, used to make the cron idempotent
  ledgerDigestDate: text("ledger_digest_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webLoginRequests = pgTable("web_login_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  secretHash: text("secret_hash").notNull().unique(),
  pairCode: text("pair_code").notNull(),
  userAgent: text("user_agent").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  // Set together with consumedAt when the user taps "거절", so the browser can say so
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("web_login_requests_active_pair_code_idx")
    .on(table.pairCode)
    .where(sql`${table.consumedAt} IS NULL`),
]);

export const webSessions = pgTable("web_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("web_sessions_user_idx").on(table.userId),
]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  slug: text("slug").notNull(),
  name: text("name"),
  directoryPath: text("directory_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique().on(table.userId, table.slug),
]);

export const todos = pgTable("todos", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  number: integer("number").notNull(),
  content: text("content").notNull(),
  title: text("title").notNull(),
  memo: text("memo"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  tags: text("tags").array().notNull().default([]),
  priority: priorityEnum("priority").notNull().default("normal"),
  deadline: timestamp("deadline"),
  status: statusEnum("status").notNull().default("pending"),
  source: sourceEnum("source").notNull().default("web"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const ideas = pgTable("ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  number: integer("number").notNull(),
  content: text("content").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  tags: text("tags").array().notNull().default([]),
  source: sourceEnum("source").notNull().default("web"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  archivedAt: timestamp("archived_at"),
});

export const workLogs = pgTable("work_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  date: timestamp("date").notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  source: sourceEnum("source").notNull().default("web"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  contentJson: text("content_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TransactionItem = { name: string; qty?: number | null; price?: number | null };
export type CategorySource = "rule" | "ai" | "user";

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  number: integer("number").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  // KRW amount as charged; may be null for foreign charges not yet converted
  amount: integer("amount"),
  currency: text("currency").notNull().default("KRW"),
  originalAmount: text("original_amount"),
  merchant: text("merchant").notNull(),
  cardOrg: text("card_org").notNull(),
  cardName: text("card_name"),
  installmentMonths: integer("installment_months").notNull().default(0),
  status: text("status").notNull().default("approved"),
  category: text("category"),
  categorySource: text("category_source").$type<CategorySource>(),
  items: jsonb("items").$type<TransactionItem[]>(),
  memo: text("memo"),
  // User-controlled exclusion from totals; never touched by the sync upsert so it survives re-sync
  excludedAt: timestamp("excluded_at", { withTimezone: true }),
  excludeReason: text("exclude_reason"),
  externalId: text("external_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("transactions_user_external_idx").on(table.userId, table.externalId),
  uniqueIndex("transactions_user_number_idx").on(table.userId, table.number),
  index("transactions_user_occurred_idx").on(table.userId, table.occurredAt),
]);
