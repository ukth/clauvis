import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { todos, projects } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { parseNaturalLanguage } from "@/lib/llm";
import { getUserId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const { searchParams } = new URL(request.url);
  const projectFilter = searchParams.get("project");
  const statusFilter = searchParams.get("status");

  const conditions = [eq(todos.userId, userId)];
  if (statusFilter) {
    conditions.push(eq(todos.status, statusFilter as "pending" | "done"));
  }
  if (projectFilter) {
    const project = await db
      .select()
      .from(projects)
      .where(and(eq(projects.name, projectFilter), eq(projects.userId, userId)))
      .limit(1);
    if (project.length > 0) {
      conditions.push(eq(todos.projectId, project[0].id));
    }
  }

  const result = await db
    .select({
      id: todos.id,
      content: todos.content,
      title: todos.title,
      memo: todos.memo,
      projectId: todos.projectId,
      projectName: projects.name,
      tags: todos.tags,
      priority: todos.priority,
      deadline: todos.deadline,
      status: todos.status,
      source: todos.source,
      createdAt: todos.createdAt,
      completedAt: todos.completedAt,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(todos.createdAt));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  const { content, source = "web" } = body;

  const parsed = await parseNaturalLanguage(content, userId);

  let projectId: string | null = null;
  if (parsed.projectName) {
    const project = await db
      .select()
      .from(projects)
      .where(and(eq(projects.name, parsed.projectName), eq(projects.userId, userId)))
      .limit(1);
    if (project.length > 0) {
      projectId = project[0].id;
    }
  }

  const [newTodo] = await db
    .insert(todos)
    .values({
      userId,
      content,
      title: parsed.title,
      memo: parsed.memo,
      projectId,
      priority: parsed.priority,
      deadline: parsed.deadline ? new Date(parsed.deadline) : null,
      source: source as "telegram" | "web" | "mcp",
    })
    .returning();

  return NextResponse.json({
    ...newTodo,
    projectName: parsed.projectName,
  });
}
