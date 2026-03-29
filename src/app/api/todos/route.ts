import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { todos, projects } from "@/lib/db/schema";
import { eq, and, desc, or } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { getNextTodoNumber } from "@/lib/db/utils";

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
      .where(and(
        or(eq(projects.slug, projectFilter), eq(projects.name, projectFilter)),
        eq(projects.userId, userId)
      ))
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
      projectSlug: projects.slug,
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
  const { title, project, priority, deadline, memo, source = "web" } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  let projectId: string | null = null;
  let projectSlug: string | null = null;
  if (project) {
    const proj = await db
      .select()
      .from(projects)
      .where(and(eq(projects.slug, project), eq(projects.userId, userId)))
      .limit(1);
    if (proj.length > 0) {
      projectId = proj[0].id;
      projectSlug = proj[0].slug;
    }
  }

  const [newTodo] = await db
    .insert(todos)
    .values({
      userId,
      number: await getNextTodoNumber(userId),
      content: title,
      title,
      memo: memo ?? null,
      projectId,
      priority: priority ?? "normal",
      deadline: deadline ? new Date(deadline) : null,
      source: source as "telegram" | "web" | "mcp",
    })
    .returning();

  return NextResponse.json({
    ...newTodo,
    projectSlug,
  });
}
