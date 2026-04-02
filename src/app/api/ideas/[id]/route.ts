import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ideas, todos, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { getNextTodoNumber } from "@/lib/db/utils";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(request);
  const { id } = await params;
  const body = await request.json();

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.body !== undefined) updateData.body = body.body;
  if (body.projectId !== undefined) updateData.projectId = body.projectId;
  if (body.tags !== undefined) updateData.tags = body.tags;

  if (body.archived === true) {
    updateData.archivedAt = new Date();
  } else if (body.archived === false) {
    updateData.archivedAt = null;
  }

  const [updated] = await db
    .update(ideas)
    .set(updateData)
    .where(and(eq(ideas.id, id), eq(ideas.userId, userId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(request);
  const { id } = await params;

  const [deleted] = await db
    .delete(ideas)
    .where(and(eq(ideas.id, id), eq(ideas.userId, userId)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

// POST /api/ideas/[id] — convert idea to todo
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(request);
  const { id } = await params;
  const body = await request.json();

  const [idea] = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.id, id), eq(ideas.userId, userId)))
    .limit(1);

  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  const [newTodo] = await db
    .insert(todos)
    .values({
      userId,
      number: await getNextTodoNumber(userId),
      content: idea.content,
      title: body.title || idea.title,
      memo: idea.body || null,
      projectId: idea.projectId,
      priority: body.priority ?? "normal",
      deadline: body.deadline ? new Date(body.deadline) : null,
      source: idea.source,
    })
    .returning();

  // Archive the original idea
  await db
    .update(ideas)
    .set({ archivedAt: new Date() })
    .where(eq(ideas.id, id));

  const projectName = idea.projectId
    ? (await db.select({ name: projects.name }).from(projects).where(eq(projects.id, idea.projectId)).limit(1))[0]?.name
    : null;

  return NextResponse.json({ ...newTodo, projectName });
}
