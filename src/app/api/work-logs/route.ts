import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workLogs, projects } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { getNextWorkLogNumber } from "@/lib/db/utils";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const { searchParams } = new URL(request.url);
  const projectFilter = searchParams.get("project");

  const conditions = [eq(workLogs.userId, userId)];

  if (projectFilter) {
    const project = await db
      .select()
      .from(projects)
      .where(and(
        eq(projects.slug, projectFilter),
        eq(projects.userId, userId)
      ))
      .limit(1);
    if (project.length > 0) {
      conditions.push(eq(workLogs.projectId, project[0].id));
    }
  }

  const result = await db
    .select({
      id: workLogs.id,
      number: workLogs.number,
      title: workLogs.title,
      content: workLogs.content,
      date: workLogs.date,
      projectId: workLogs.projectId,
      projectSlug: projects.slug,
      projectName: projects.name,
      source: workLogs.source,
      createdAt: workLogs.createdAt,
    })
    .from(workLogs)
    .leftJoin(projects, eq(workLogs.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(workLogs.date));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  const { title, content, date, project, source = "web" } = body;

  if (!title || !content) {
    return NextResponse.json(
      { error: "title and content are required" },
      { status: 400 }
    );
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

  const [newLog] = await db
    .insert(workLogs)
    .values({
      userId,
      number: await getNextWorkLogNumber(userId),
      title,
      content,
      date: date ? new Date(date) : new Date(),
      projectId,
      source: source as "telegram" | "web" | "mcp",
    })
    .returning();

  return NextResponse.json({ ...newLog, projectSlug });
}
