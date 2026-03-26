import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const result = await db.select().from(projects);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, aliases = [], directoryPath = null } = body;

  const [project] = await db
    .insert(projects)
    .values({ name, aliases, directoryPath })
    .returning();

  return NextResponse.json(project);
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updateData } = body;

  const [updated] = await db
    .update(projects)
    .set(updateData)
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
