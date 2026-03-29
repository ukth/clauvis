import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { todos, projects, users, chatMessages } from "./db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getNextTodoNumber } from "./db/utils";
import { esc } from "./telegram";

const SYSTEM_PROMPT = `You are Clauvis, a todo management assistant. Use the appropriate tools based on the user's message, or respond directly for casual conversation.

Rules:
- Always respond in the user's language
- Friendly and concise tone
- When adding todos: fix typos/abbreviations, convert relative dates to absolute dates, actively fill the memo field with context/reasons/details from the user's message
- After adding a todo, show the memo content and ask if they want to modify or add anything
- If the user wants to add/edit a memo on an existing todo, use update_todo
- Project slugs are lowercase letters and hyphens
- When completing/deleting by number, interpret as the stable #number from list results
- Use emojis appropriately
- For casual conversation, greetings, or questions, respond directly without tools
- When relaying tool results to the user, reflect them accurately. Do not fabricate or modify content
- Do not change the count, names, or content of tool result items
- Format responses in plain text. Do NOT use Markdown or MarkdownV2 formatting. No escaping needed.`;

const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "list_todos",
    description: "List todos, grouped by project.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "Filter by project slug (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "add_todo",
    description: "Add a new todo.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Todo title (cleaned up)" },
        project_slug: {
          type: "string",
          description: "Project slug (match from registered projects)",
        },
        priority: {
          type: "string",
          enum: ["urgent", "normal", "low"],
          description: "Priority level",
        },
        deadline: {
          type: "string",
          description: "Deadline (YYYY-MM-DD format)",
        },
        memo: { type: "string", description: "Additional notes" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_todo",
    description: "Mark a todo as done. Specify by project slug + number, or by keyword in the title.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "Project slug (needed when using number)",
        },
        number: {
          type: "number",
          description: "Todo number from list_todos results",
        },
        keyword: {
          type: "string",
          description: "Keyword in todo title (alternative to number)",
        },
      },
      required: [],
    },
  },
  {
    name: "delete_todo",
    description: "Delete a todo. Specify by project slug + number, or by keyword in the title.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "Project slug (needed when using number)",
        },
        number: {
          type: "number",
          description: "Todo number",
        },
        keyword: {
          type: "string",
          description: "Keyword in todo title (alternative to number)",
        },
      },
      required: [],
    },
  },
  {
    name: "update_todo",
    description: "Update a todo's title, memo, priority, or deadline.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "Project slug (needed when using number)",
        },
        number: {
          type: "number",
          description: "Todo number",
        },
        keyword: {
          type: "string",
          description: "Keyword in todo title (alternative to number)",
        },
        title: { type: "string", description: "New title" },
        memo: { type: "string", description: "New memo" },
        priority: {
          type: "string",
          enum: ["urgent", "normal", "low"],
          description: "New priority",
        },
        deadline: { type: "string", description: "New deadline (YYYY-MM-DD)" },
      },
      required: [],
    },
  },
  {
    name: "view_todo",
    description: "View detailed info of a single todo by its #number. Shows title, memo, project, priority, deadline, status.",
    input_schema: {
      type: "object" as const,
      properties: {
        number: {
          type: "number",
          description: "Todo #number",
        },
      },
      required: ["number"],
    },
  },
  {
    name: "list_projects",
    description: "List all registered projects.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "add_project",
    description: "Add a new project.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "Project slug (lowercase, hyphens)",
        },
        name: { type: "string", description: "Display name" },
      },
      required: ["slug"],
    },
  },
  {
    name: "delete_project",
    description: "Delete a project.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Slug of the project to delete" },
      },
      required: ["slug"],
    },
  },
];

// --- Tool execution functions ---

async function execListTodos(
  userId: string,
  input: { project_slug?: string }
): Promise<string> {
  const conditions = [eq(todos.userId, userId), eq(todos.status, "pending")];

  if (input.project_slug) {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.slug, input.project_slug), eq(projects.userId, userId)))
      .limit(1);
    if (project) {
      conditions.push(eq(todos.projectId, project.id));
    }
  }

  const result = await db
    .select({
      number: todos.number,
      title: todos.title,
      priority: todos.priority,
      deadline: todos.deadline,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(todos.createdAt));

  if (result.length === 0) {
    return "No todos.";
  }

  const grouped: Record<string, { display: string; items: typeof result }> = {};
  for (const todo of result) {
    const slug = todo.projectSlug || "Uncategorized";
    const display = todo.projectName ? `${todo.projectName}[${slug}]` : slug;
    if (!grouped[slug]) grouped[slug] = { display, items: [] };
    grouped[slug].items.push(todo);
  }

  let message = `${result.length} todos:\n`;
  for (const [, group] of Object.entries(grouped)) {
    message += `\n[${group.display}]\n`;
    const items = group.items;
    for (const item of items) {
      const deadlineStr = item.deadline
        ? ` (deadline: ${item.deadline.toISOString().split("T")[0]})`
        : "";
      const priorityStr = item.priority !== "normal" ? ` [${item.priority}]` : "";
      message += `#${item.number}. ${item.title}${priorityStr}${deadlineStr}\n`;
    }
  }

  return message;
}

async function execAddTodo(
  userId: string,
  originalMessage: string,
  input: { title: string; project_slug?: string; priority?: string; deadline?: string; memo?: string }
): Promise<string> {
  let projectId: string | null = null;
  let projectDisplayName: string | null = null;

  if (input.project_slug) {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.slug, input.project_slug), eq(projects.userId, userId)))
      .limit(1);
    if (project) {
      projectId = project.id;
      projectDisplayName = project.name || project.slug;
    }
  }

  const number = await getNextTodoNumber(userId);
  await db.insert(todos).values({
    userId,
    number,
    content: originalMessage,
    title: input.title,
    memo: input.memo || null,
    projectId,
    priority: (input.priority as "urgent" | "normal" | "low") || "normal",
    deadline: input.deadline ? new Date(input.deadline) : null,
    source: "telegram",
  });

  const projectLabel = projectDisplayName
    ? `${projectDisplayName}[${input.project_slug}]`
    : input.project_slug || "Uncategorized";
  const memoStr = input.memo ? `\nmemo: ${input.memo}` : "";
  return `Added: [${projectLabel}] ${input.title}${memoStr}`;
}

async function execCompleteTodo(
  userId: string,
  input: { project_slug?: string; number?: number; keyword?: string }
): Promise<string> {
  const pendingTodos = await db
    .select({
      id: todos.id,
      title: todos.title,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
    .orderBy(desc(todos.createdAt));

  const todo = findTodoByInput(pendingTodos, input);
  if (!todo) {
    return "Todo not found.";
  }

  await db
    .update(todos)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(todos.id, todo.id));

  const remaining = pendingTodos.length - 1;
  return `Done: ${todo.title} (${remaining} remaining)`;
}

async function execDeleteTodo(
  userId: string,
  input: { project_slug?: string; number?: number; keyword?: string }
): Promise<string> {
  const pendingTodos = await db
    .select({
      id: todos.id,
      title: todos.title,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
    .orderBy(desc(todos.createdAt));

  const todo = findTodoByInput(pendingTodos, input);
  if (!todo) {
    return "Todo not found.";
  }

  await db.delete(todos).where(eq(todos.id, todo.id));
  return `Deleted: ${todo.title}`;
}

async function execUpdateTodo(
  userId: string,
  input: { project_slug?: string; number?: number; keyword?: string; title?: string; memo?: string; priority?: string; deadline?: string }
): Promise<string> {
  const pendingTodos = await db
    .select({
      id: todos.id,
      title: todos.title,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
    .orderBy(desc(todos.createdAt));

  const todo = findTodoByInput(pendingTodos, input);
  if (!todo) {
    return "Todo not found.";
  }

  const updateData: Record<string, unknown> = {};
  if (input.title) updateData.title = input.title;
  if (input.memo !== undefined) updateData.memo = input.memo;
  if (input.priority) updateData.priority = input.priority;
  if (input.deadline) updateData.deadline = new Date(input.deadline);

  await db.update(todos).set(updateData).where(eq(todos.id, todo.id));

  const fields = Object.keys(updateData).join(", ");
  return `Updated: ${todo.title} (${fields})`;
}

function findTodoByInput(
  pendingTodos: Array<{ id: string; title: string; projectName: string | null; projectSlug: string | null }>,
  input: { project_slug?: string; number?: number; keyword?: string }
): { id: string; title: string } | null {
  if (input.number != null && input.project_slug) {
    // Group by project slug, find by number within that group
    const grouped: Record<string, typeof pendingTodos> = {};
    for (const t of pendingTodos) {
      const key = t.projectSlug || "__uncategorized__";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    }
    const group = grouped[input.project_slug];
    if (group && input.number >= 1 && input.number <= group.length) {
      return group[input.number - 1];
    }
    return null;
  }

  if (input.number != null) {
    // No project specified - use flat numbering across all
    if (input.number >= 1 && input.number <= pendingTodos.length) {
      return pendingTodos[input.number - 1];
    }
    return null;
  }

  if (input.keyword) {
    return pendingTodos.find((t) =>
      t.title.toLowerCase().includes(input.keyword!.toLowerCase())
    ) || null;
  }

  return null;
}

async function execViewTodo(
  userId: string,
  input: { number: number }
): Promise<string> {
  const [todo] = await db
    .select({
      number: todos.number,
      title: todos.title,
      memo: todos.memo,
      priority: todos.priority,
      deadline: todos.deadline,
      status: todos.status,
      source: todos.source,
      projectName: projects.name,
      projectSlug: projects.slug,
      createdAt: todos.createdAt,
      completedAt: todos.completedAt,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(eq(todos.userId, userId), eq(todos.number, input.number)))
    .limit(1);

  if (!todo) {
    return `Todo #${input.number} not found.`;
  }

  const project = todo.projectName || todo.projectSlug || "Uncategorized";
  const priority = todo.priority !== "normal" ? `\nPriority: ${todo.priority}` : "";
  const deadline = todo.deadline
    ? `\nDeadline: ${todo.deadline.toISOString().split("T")[0]}`
    : "";
  const memo = todo.memo ? `\nMemo: ${todo.memo}` : "";
  const status = todo.status === "done" ? "Done" : "Pending";
  const completed = todo.completedAt
    ? `\nCompleted: ${todo.completedAt.toISOString().split("T")[0]}`
    : "";
  const created = todo.createdAt.toISOString().split("T")[0];

  return `#${todo.number} ${todo.title}\nProject: ${project}\nStatus: ${status}${priority}${deadline}\nCreated: ${created}${completed}${memo}`;
}

async function execListProjects(userId: string): Promise<string> {
  const allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  if (allProjects.length === 0) {
    return "No projects registered.";
  }

  let msg = `${allProjects.length} projects:\n`;
  for (const p of allProjects) {
    msg += `- ${p.name || p.slug}\n`;
  }
  return msg;
}

async function execAddProject(
  userId: string,
  input: { slug: string; name?: string }
): Promise<string> {
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, input.slug), eq(projects.userId, userId)))
    .limit(1);

  if (existing) {
    const displayName = existing.name || existing.slug;
    return `Project "${displayName}" already exists.`;
  }

  await db.insert(projects).values({
    userId,
    slug: input.slug,
    name: input.name || null,
  });

  const displayName = input.name || input.slug;
  return `Project added: ${displayName}`;
}

async function execDeleteProject(
  userId: string,
  input: { slug: string }
): Promise<string> {
  const [target] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, input.slug), eq(projects.userId, userId)))
    .limit(1);

  if (!target) {
    return `Project "${input.slug}" not found.`;
  }

  await db.delete(projects).where(eq(projects.id, target.id));
  return `Project deleted: ${target.name || target.slug}`;
}

// --- Tool dispatcher ---

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  originalMessage: string
): Promise<string> {
  switch (toolName) {
    case "list_todos":
      return execListTodos(userId, toolInput as { project_slug?: string });
    case "add_todo":
      return execAddTodo(userId, originalMessage, toolInput as {
        title: string; project_slug?: string; priority?: string; deadline?: string; memo?: string;
      });
    case "complete_todo":
      return execCompleteTodo(userId, toolInput as {
        project_slug?: string; number?: number; keyword?: string;
      });
    case "delete_todo":
      return execDeleteTodo(userId, toolInput as {
        project_slug?: string; number?: number; keyword?: string;
      });
    case "update_todo":
      return execUpdateTodo(userId, toolInput as {
        project_slug?: string; number?: number; keyword?: string;
        title?: string; memo?: string; priority?: string; deadline?: string;
      });
    case "view_todo":
      return execViewTodo(userId, toolInput as { number: number });
    case "list_projects":
      return execListProjects(userId);
    case "add_project":
      return execAddProject(userId, toolInput as {
        slug: string; name?: string;
      });
    case "delete_project":
      return execDeleteProject(userId, toolInput as { slug: string });
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// --- Conversation history ---

export async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await db.insert(chatMessages).values({ userId, role, content });
}

export async function getRecentMessages(
  userId: string,
  limit = 10
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const messages = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return messages.reverse();
}

// --- Agent loop ---

const MODEL_MAP: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

export async function runAgent(
  userMessage: string,
  userId: string,
  anthropicApiKey: string,
  model?: string
): Promise<string> {
  const client = new Anthropic({ apiKey: anthropicApiKey });
  const modelId = MODEL_MAP[model || "sonnet"] || MODEL_MAP.sonnet;
  // Load project context for system prompt
  const projectList = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  const projectContext = projectList
    .map((p) => {
      const displayName = p.name ? ` (${p.name})` : "";
      return `- slug: ${p.slug}${displayName}`;
    })
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `${SYSTEM_PROMPT}

Today: ${today}

Registered projects:
${projectContext || "None"}`;

  // Load conversation history
  const history = await getRecentMessages(userId);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  console.log(`[AGENT] messages=${JSON.stringify(messages)}`);

  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    // Check if response contains tool use
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );

    if (toolUseBlocks.length === 0) {
      // No tool use - return the text response
      return textBlocks.map((b) => b.text).join("\n") || "Got it!";
    }

    // Process tool calls
    // Add assistant message with full content to messages
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        userId,
        userMessage
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });

    // If stop_reason is "end_turn" and we have text, we're done
    if (response.stop_reason === "end_turn" && textBlocks.length > 0) {
      return textBlocks.map((b) => b.text).join("\n");
    }
  }

  return "Max iterations reached. Please try again.";
}
