import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { db } from "@/lib/db";
import { todos, projects, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

function createServer(userId: string) {
  const server = new McpServer(
    { name: "clauvis", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "list_todos",
    {
      title: "List Todos",
      description:
        "할일 목록을 조회합니다. project로 필터링 가능합니다.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("프로젝트명으로 필터링 (없으면 전체)"),
        status: z
          .enum(["pending", "done"])
          .optional()
          .describe("상태 필터 (기본: pending)"),
      },
    },
    async ({ project, status = "pending" }) => {
      const conditions = [
        eq(todos.userId, userId),
        eq(todos.status, status),
      ];

      if (project) {
        const proj = await db
          .select()
          .from(projects)
          .where(
            and(eq(projects.slug, project), eq(projects.userId, userId))
          )
          .limit(1);
        if (proj.length > 0) {
          conditions.push(eq(todos.projectId, proj[0].id));
        }
      }

      const result = await db
        .select({
          id: todos.id,
          title: todos.title,
          memo: todos.memo,
          priority: todos.priority,
          deadline: todos.deadline,
          status: todos.status,
          projectSlug: projects.slug,
          projectName: projects.name,
        })
        .from(todos)
        .leftJoin(projects, eq(todos.projectId, projects.id))
        .where(and(...conditions))
        .orderBy(desc(todos.createdAt));

      if (result.length === 0) {
        return { content: [{ type: "text" as const, text: "할일이 없습니다." }] };
      }

      const text = result
        .map((t, i) => {
          const deadline = t.deadline
            ? ` (기한: ${t.deadline.toISOString().split("T")[0]})`
            : "";
          const proj = (t.projectName || t.projectSlug) ? `[${t.projectName || t.projectSlug}] ` : "";
          return `${i + 1}. ${proj}${t.title}${deadline}`;
        })
        .join("\n");

      return {
        content: [
          { type: "text" as const, text: `할일 ${result.length}개:\n${text}` },
        ],
      };
    }
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add Todo",
      description: "새 할일을 추가합니다.",
      inputSchema: {
        title: z.string().describe("할일 제목"),
        project: z.string().optional().describe("프로젝트 slug"),
        priority: z.enum(["urgent", "normal", "low"]).optional().describe("우선순위 (기본: normal)"),
        deadline: z.string().optional().describe("마감일 (YYYY-MM-DD)"),
        memo: z.string().optional().describe("메모"),
      },
    },
    async ({ title, project, priority, deadline, memo }) => {
      let projectId: string | null = null;
      let projectLabel = "미분류";

      if (project) {
        const proj = await db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.slug, project),
              eq(projects.userId, userId)
            )
          )
          .limit(1);
        if (proj.length > 0) {
          projectId = proj[0].id;
          projectLabel = proj[0].name || proj[0].slug;
        }
      }

      const [newTodo] = await db
        .insert(todos)
        .values({
          userId,
          content: title,
          title,
          memo: memo ?? null,
          projectId,
          priority: priority ?? "normal",
          deadline: deadline ? new Date(deadline) : null,
          source: "mcp",
        })
        .returning();

      return {
        content: [
          {
            type: "text" as const,
            text: `${projectLabel} > ${newTodo.title} 추가했습니다.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "complete_todo",
    {
      title: "Complete Todo",
      description:
        "할일을 완료 처리합니다. 번호(목록 순서) 또는 할일 제목으로 지정합니다.",
      inputSchema: {
        target: z
          .string()
          .describe("완료할 할일 번호(1부터) 또는 제목 키워드"),
      },
    },
    async ({ target }) => {
      const pendingTodos = await db
        .select({ id: todos.id, title: todos.title })
        .from(todos)
        .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
        .orderBy(desc(todos.createdAt));

      const num = parseInt(target);
      let matched;

      if (!isNaN(num) && num >= 1 && num <= pendingTodos.length) {
        matched = pendingTodos[num - 1];
      } else {
        matched = pendingTodos.find((t) =>
          t.title.toLowerCase().includes(target.toLowerCase())
        );
      }

      if (!matched) {
        return {
          content: [
            {
              type: "text" as const,
              text: `"${target}"에 해당하는 할일을 찾지 못했습니다.`,
            },
          ],
        };
      }

      await db
        .update(todos)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(todos.id, matched.id));

      return {
        content: [
          {
            type: "text" as const,
            text: `✓ ${matched.title} 완료! 남은 할일 ${pendingTodos.length - 1}개`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "delete_todo",
    {
      title: "Delete Todo",
      description: "할일을 삭제합니다. 번호(목록 순서) 또는 할일 제목으로 지정합니다.",
      inputSchema: {
        target: z.string().describe("삭제할 할일 번호(1부터) 또는 제목 키워드"),
      },
    },
    async ({ target }) => {
      const pendingTodos = await db
        .select({ id: todos.id, title: todos.title })
        .from(todos)
        .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
        .orderBy(desc(todos.createdAt));

      const num = parseInt(target);
      let matched;

      if (!isNaN(num) && num >= 1 && num <= pendingTodos.length) {
        matched = pendingTodos[num - 1];
      } else {
        matched = pendingTodos.find((t) =>
          t.title.toLowerCase().includes(target.toLowerCase())
        );
      }

      if (!matched) {
        return {
          content: [
            { type: "text" as const, text: `"${target}"에 해당하는 할일을 찾지 못했습니다.` },
          ],
        };
      }

      await db.delete(todos).where(eq(todos.id, matched.id));

      return {
        content: [
          { type: "text" as const, text: `🗑 ${matched.title} 삭제 완료` },
        ],
      };
    }
  );

  server.registerTool(
    "update_todo",
    {
      title: "Update Todo",
      description: "할일의 제목, 메모, 우선순위, 기한을 수정합니다.",
      inputSchema: {
        target: z.string().describe("수정할 할일 번호(1부터) 또는 제목 키워드"),
        title: z.string().optional().describe("변경할 제목"),
        memo: z.string().optional().describe("변경할 메모"),
        priority: z.enum(["urgent", "normal", "low"]).optional().describe("변경할 우선순위"),
        deadline: z.string().optional().describe("변경할 기한 (YYYY-MM-DD)"),
      },
    },
    async ({ target, title, memo, priority, deadline }) => {
      const pendingTodos = await db
        .select({ id: todos.id, title: todos.title })
        .from(todos)
        .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
        .orderBy(desc(todos.createdAt));

      const num = parseInt(target);
      let matched;

      if (!isNaN(num) && num >= 1 && num <= pendingTodos.length) {
        matched = pendingTodos[num - 1];
      } else {
        matched = pendingTodos.find((t) =>
          t.title.toLowerCase().includes(target.toLowerCase())
        );
      }

      if (!matched) {
        return {
          content: [
            { type: "text" as const, text: `"${target}"에 해당하는 할일을 찾지 못했습니다.` },
          ],
        };
      }

      const updateData: Record<string, unknown> = {};
      if (title) updateData.title = title;
      if (memo !== undefined) updateData.memo = memo;
      if (priority) updateData.priority = priority;
      if (deadline) updateData.deadline = new Date(deadline);

      await db.update(todos).set(updateData).where(eq(todos.id, matched.id));

      const fields = Object.keys(updateData).join(", ");
      return {
        content: [
          { type: "text" as const, text: `✏️ ${matched.title} 수정 완료 (${fields})` },
        ],
      };
    }
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "등록된 프로젝트 목록을 조회합니다.",
      inputSchema: {},
    },
    async () => {
      const result = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId));

      if (result.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "등록된 프로젝트가 없습니다." },
          ],
        };
      }

      const text = result
        .map((p) => {
          const displayName = p.name || p.slug;
          const slugLabel = p.name ? ` [${p.slug}]` : "";
          return `• ${displayName}${slugLabel}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `프로젝트 ${result.length}개:\n${text}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "add_project",
    {
      title: "Add Project",
      description: "새 프로젝트를 등록합니다.",
      inputSchema: {
        slug: z.string().describe("프로젝트 슬러그 (매칭용, 필수)"),
        name: z.string().optional().describe("프로젝트 표시명 (선택)"),
        directoryPath: z
          .string()
          .optional()
          .describe("로컬 디렉토리 경로"),
      },
    },
    async ({ slug, name, directoryPath }) => {
      const existing = await db
        .select()
        .from(projects)
        .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
        .limit(1);

      if (existing.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `"${slug}" 프로젝트는 이미 존재합니다.`,
            },
          ],
        };
      }

      await db.insert(projects).values({
        userId,
        slug,
        name: name ?? null,
        directoryPath: directoryPath ?? null,
      });

      const displayName = name || slug;
      return {
        content: [
          { type: "text" as const, text: `📁 ${displayName} 프로젝트 추가했습니다.` },
        ],
      };
    }
  );

  server.registerTool(
    "delete_project",
    {
      title: "Delete Project",
      description: "프로젝트를 삭제합니다. 해당 프로젝트의 할일은 미분류로 이동됩니다.",
      inputSchema: {
        slug: z.string().describe("삭제할 프로젝트 slug"),
      },
    },
    async ({ slug }) => {
      const [target] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
        .limit(1);

      if (!target) {
        return {
          content: [
            { type: "text" as const, text: `"${slug}" 프로젝트를 찾지 못했습니다.` },
          ],
        };
      }

      await db.delete(projects).where(eq(projects.id, target.id));

      return {
        content: [
          { type: "text" as const, text: `🗑 ${target.name || target.slug} 프로젝트 삭제 완료` },
        ],
      };
    }
  );

  return server;
}

async function getUserFromRequest(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  const apiKey = authHeader?.replace("Bearer ", "");
  if (!apiKey) return null;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  return user?.id ?? null;
}

export async function POST(request: Request) {
  const userId = await getUserFromRequest(request);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const server = createServer(userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET() {
  return new Response("Clauvis MCP Server", { status: 200 });
}

export async function DELETE() {
  return new Response("Method not allowed", { status: 405 });
}
