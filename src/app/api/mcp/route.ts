import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { db } from "@/lib/db";
import { todos, projects, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getNextTodoNumber } from "@/lib/db/utils";

function createServer(userId: string) {
  const server = new McpServer(
    { name: "clauvis", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "list_todos",
    {
      title: "List Todos",
      description: "List todos, optionally filtered by project.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Filter by project slug (optional)"),
        status: z
          .enum(["pending", "done"])
          .optional()
          .describe("Status filter (default: pending)"),
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
          number: todos.number,
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
        return { content: [{ type: "text" as const, text: "No todos." }] };
      }

      const text = result
        .map((t) => {
          const deadline = t.deadline
            ? ` (deadline: ${t.deadline.toISOString().split("T")[0]})`
            : "";
          const proj = (t.projectName || t.projectSlug) ? `[${t.projectName || t.projectSlug}] ` : "";
          return `#${t.number}. ${proj}${t.title}${deadline}`;
        })
        .join("\n");

      return {
        content: [
          { type: "text" as const, text: `${result.length} todos:\n${text}` },
        ],
      };
    }
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add Todo",
      description: "Add a new todo.",
      inputSchema: {
        title: z.string().describe("Todo title"),
        project: z.string().optional().describe("Project slug"),
        priority: z.enum(["urgent", "normal", "low"]).optional().describe("Priority (default: normal)"),
        deadline: z.string().optional().describe("Deadline (YYYY-MM-DD)"),
        memo: z.string().optional().describe("Memo"),
      },
    },
    async ({ title, project, priority, deadline, memo }) => {
      let projectId: string | null = null;
      let projectLabel = "Uncategorized";

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
          number: await getNextTodoNumber(userId),
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
            text: `Added: ${projectLabel} > ${newTodo.title}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "complete_todo",
    {
      title: "Complete Todo",
      description: "Mark a todo as done. Specify by #number or title keyword.",
      inputSchema: {
        target: z
          .string()
          .describe("Todo #number or title keyword"),
      },
    },
    async ({ target }) => {
      const num = parseInt(target);
      let matched;

      if (!isNaN(num)) {
        const [todo] = await db
          .select({ id: todos.id, title: todos.title })
          .from(todos)
          .where(and(eq(todos.userId, userId), eq(todos.number, num)))
          .limit(1);
        matched = todo;
      } else {
        const pendingTodos = await db
          .select({ id: todos.id, title: todos.title })
          .from(todos)
          .where(and(eq(todos.userId, userId), eq(todos.status, "pending")));
        matched = pendingTodos.find((t) =>
          t.title.toLowerCase().includes(target.toLowerCase())
        );
      }

      if (!matched) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Todo "${target}" not found.`,
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
            text: `✓ #${num || ''} ${matched.title} done!`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "delete_todo",
    {
      title: "Delete Todo",
      description: "Delete a todo. Specify by #number or title keyword.",
      inputSchema: {
        target: z.string().describe("Todo #number or title keyword"),
      },
    },
    async ({ target }) => {
      const num = parseInt(target);
      let matched;

      if (!isNaN(num)) {
        const [todo] = await db
          .select({ id: todos.id, title: todos.title })
          .from(todos)
          .where(and(eq(todos.userId, userId), eq(todos.number, num)))
          .limit(1);
        matched = todo;
      } else {
        const allTodos = await db
          .select({ id: todos.id, title: todos.title })
          .from(todos)
          .where(and(eq(todos.userId, userId), eq(todos.status, "pending")));
        matched = allTodos.find((t) =>
          t.title.toLowerCase().includes(target.toLowerCase())
        );
      }

      if (!matched) {
        return {
          content: [
            { type: "text" as const, text: `Todo "${target}" not found.` },
          ],
        };
      }

      await db.delete(todos).where(eq(todos.id, matched.id));

      return {
        content: [
          { type: "text" as const, text: `🗑 #${num || ''} ${matched.title} deleted.` },
        ],
      };
    }
  );

  server.registerTool(
    "update_todo",
    {
      title: "Update Todo",
      description: "Update a todo's title, memo, priority, or deadline.",
      inputSchema: {
        target: z.string().describe("Todo #number or title keyword"),
        title: z.string().optional().describe("New title"),
        memo: z.string().optional().describe("New memo"),
        priority: z.enum(["urgent", "normal", "low"]).optional().describe("New priority"),
        deadline: z.string().optional().describe("New deadline (YYYY-MM-DD)"),
      },
    },
    async ({ target, title, memo, priority, deadline }) => {
      const num = parseInt(target);
      let matched;

      if (!isNaN(num)) {
        const [todo] = await db
          .select({ id: todos.id, title: todos.title })
          .from(todos)
          .where(and(eq(todos.userId, userId), eq(todos.number, num)))
          .limit(1);
        matched = todo;
      } else {
        const allTodos = await db
          .select({ id: todos.id, title: todos.title })
          .from(todos)
          .where(and(eq(todos.userId, userId), eq(todos.status, "pending")));
        matched = allTodos.find((t) =>
          t.title.toLowerCase().includes(target.toLowerCase())
        );
      }

      if (!matched) {
        return {
          content: [
            { type: "text" as const, text: `Todo "${target}" not found.` },
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
          { type: "text" as const, text: `✏️ ${matched.title} updated (${fields})` },
        ],
      };
    }
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "List all registered projects.",
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
            { type: "text" as const, text: "No projects registered." },
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
            text: `${result.length} projects:\n${text}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "add_project",
    {
      title: "Add Project",
      description: "Register a new project.",
      inputSchema: {
        slug: z.string().describe("Project slug (lowercase, hyphens)"),
        name: z.string().optional().describe("Display name (optional)"),
        directoryPath: z
          .string()
          .optional()
          .describe("Local directory path"),
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
              text: `Project "${slug}" already exists.`,
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
          { type: "text" as const, text: `📁 Project ${displayName} added.` },
        ],
      };
    }
  );

  server.registerTool(
    "delete_project",
    {
      title: "Delete Project",
      description: "Delete a project. Todos in the project become uncategorized.",
      inputSchema: {
        slug: z.string().describe("Slug of the project to delete"),
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
            { type: "text" as const, text: `Project "${slug}" not found.` },
          ],
        };
      }

      await db.delete(projects).where(eq(projects.id, target.id));

      return {
        content: [
          { type: "text" as const, text: `🗑 Project ${target.name || target.slug} deleted.` },
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
