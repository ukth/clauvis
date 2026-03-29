import { pgTable, uuid, text, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
