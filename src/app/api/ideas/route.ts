import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ideas, projects } from "@/lib/db/schema";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { getNextIdeaNumber } from "@/lib/db/utils";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const { searchParams } = new URL(request.url);
  const projectFilter = searchParams.get("project");
  const archived = searchParams.get("archived") === "true";

  const conditions = [eq(ideas.userId, userId)];
  if (!archived) {
    conditions.push(isNull(ideas.archivedAt));
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
      conditions.push(eq(ideas.projectId, project[0].id));
    }
  }

  const result = await db
    .select({
      id: ideas.id,
      number: ideas.number,
      content: ideas.content,
      title: ideas.title,
      body: ideas.body,
      projectId: ideas.projectId,
      projectSlug: projects.slug,
      projectName: projects.name,
      tags: ideas.tags,
      source: ideas.source,
      createdAt: ideas.createdAt,
      archivedAt: ideas.archivedAt,
    })
    .from(ideas)
    .leftJoin(projects, eq(ideas.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(ideas.createdAt));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  const { title, project, body: ideaBody, tags, source = "web" } = body;

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

  const [newIdea] = await db
    .insert(ideas)
    .values({
      userId,
      number: await getNextIdeaNumber(userId),
      content: title,
      title,
      body: ideaBody ?? null,
      projectId,
      tags: tags ?? [],
      source: source as "telegram" | "web" | "mcp",
    })
    .returning();

  return NextResponse.json({ ...newIdea, projectSlug });
}
