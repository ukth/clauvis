import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workLogs } from "@/lib/db/schema";
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
  if (body.content !== undefined) updateData.content = body.content;
  if (body.date !== undefined) updateData.date = new Date(body.date);
  if (body.projectId !== undefined) updateData.projectId = body.projectId;

  const [updated] = await db
    .update(workLogs)
    .set(updateData)
    .where(and(eq(workLogs.id, id), eq(workLogs.userId, userId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Work log not found" }, { status: 404 });
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
    .delete(workLogs)
    .where(and(eq(workLogs.id, id), eq(workLogs.userId, userId)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Work log not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
