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
  const { slug, name = null, directoryPath = null } = body;

  const existing = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "Project slug already exists" }, { status: 409 });
  }

  const [project] = await db
    .insert(projects)
    .values({ userId, slug, name, directoryPath })
    .returning();

  return NextResponse.json(project);
}

export async function PATCH(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  const { id, slug, name, directoryPath } = body;

  const updateData: Record<string, unknown> = {};
  if (slug !== undefined) updateData.slug = slug;
  if (name !== undefined) updateData.name = name;
  if (directoryPath !== undefined) updateData.directoryPath = directoryPath;

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
