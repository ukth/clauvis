import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const priorityEnum = pgEnum("priority", ["urgent", "normal", "low"]);
export const statusEnum = pgEnum("status", ["pending", "done"]);
export const sourceEnum = pgEnum("source", ["telegram", "web", "mcp"]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull().default([]),
  directoryPath: text("directory_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const todos = pgTable("todos", {
  id: uuid("id").defaultRandom().primaryKey(),
  content: text("content").notNull(),
  title: text("title").notNull(),
  memo: text("memo"),
  projectId: uuid("project_id").references(() => projects.id),
  tags: text("tags").array().notNull().default([]),
  priority: priorityEnum("priority").notNull().default("normal"),
  deadline: timestamp("deadline"),
  status: statusEnum("status").notNull().default("pending"),
  source: sourceEnum("source").notNull().default("web"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});
