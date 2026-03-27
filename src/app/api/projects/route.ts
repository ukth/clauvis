import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  const { name, aliases = [], directoryPath = null } = body;

  const [project] = await db
    .insert(projects)
    .values({ userId, name, aliases, directoryPath })
    .returning();

  return NextResponse.json(project);
}

export async function PATCH(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  const { id, ...updateData } = body;

  const [updated] = await db
    .update(projects)
    .set(updateData)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
