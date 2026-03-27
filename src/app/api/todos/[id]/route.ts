import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { todos } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(request);
  const { id } = await params;
  const body = await request.json();

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.memo !== undefined) updateData.memo = body.memo;
  if (body.projectId !== undefined) updateData.projectId = body.projectId;
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.deadline !== undefined)
    updateData.deadline = body.deadline ? new Date(body.deadline) : null;
  if (body.tags !== undefined) updateData.tags = body.tags;

  if (body.status === "done") {
    updateData.status = "done";
    updateData.completedAt = new Date();
  } else if (body.status === "pending") {
    updateData.status = "pending";
    updateData.completedAt = null;
  }

  const [updated] = await db
    .update(todos)
    .set(updateData)
    .where(and(eq(todos.id, id), eq(todos.userId, userId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Todo not found" }, { status: 404 });
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
    .delete(todos)
    .where(and(eq(todos.id, id), eq(todos.userId, userId)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Todo not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
