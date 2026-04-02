import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { todos, projects, users, chatMessages, ideas } from "./db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getNextTodoNumber, getNextIdeaNumber } from "./db/utils";
import { esc } from "./telegram";

const SYSTEM_PROMPT = `You are Clauvis, a todo and idea management assistant. Use the appropriate tools based on the user's message, or respond directly for casual conversation.

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
- Format responses in Telegram Markdown: *bold*, _italic_, \`code\`. No special escaping needed.

Todo vs Idea:
- Todo: actionable tasks that need to be done (e.g. "fix bug", "add feature", "deploy")
- Idea: thoughts, inspirations, references, or not-yet-concrete plans (e.g. "maybe add dark mode", "look into X", "interesting approach for Y")
- When ambiguous, ask the user: "할일로 추가할까요, 아이디어로 메모할까요?"
- Keywords suggesting idea: "아이디어", "메모", "나중에 참고", "생각인데", "영감", "maybe", "idea"
- Keywords suggesting todo: "해야", "수정", "추가해줘", "고쳐", "fix", "add", "implement"`;

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
  {
    name: "add_idea",
    description: "Save an idea or memo. For thoughts, inspirations, references — not actionable tasks.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Idea title (cleaned up)" },
        body: { type: "string", description: "Detailed description or notes" },
        project_slug: { type: "string", description: "Project slug" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_ideas",
    description: "List saved ideas, optionally filtered by project.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: { type: "string", description: "Filter by project slug" },
      },
      required: [],
    },
  },
  {
    name: "delete_idea",
    description: "Delete an idea by number or keyword.",
    input_schema: {
      type: "object" as const,
      properties: {
        number: { type: "number", description: "Idea number" },
        keyword: { type: "string", description: "Keyword in idea title" },
      },
      required: [],
    },
  },
  {
    name: "convert_idea_to_todo",
    description: "Convert an idea into a todo. The idea gets archived.",
    input_schema: {
      type: "object" as const,
      properties: {
        number: { type: "number", description: "Idea number" },
        keyword: { type: "string", description: "Keyword in idea title" },
        priority: { type: "string", enum: ["urgent", "normal", "low"], description: "Priority for the new todo" },
        deadline: { type: "string", description: "Deadline for the new todo (YYYY-MM-DD)" },
      },
      required: [],
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

// --- Idea execution functions ---

async function execAddIdea(
  userId: string,
  input: { title: string; body?: string; project_slug?: string; tags?: string[] }
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

  const number = await getNextIdeaNumber(userId);
  await db.insert(ideas).values({
    userId,
    number,
    content: input.title,
    title: input.title,
    body: input.body || null,
    projectId,
    tags: input.tags || [],
    source: "telegram",
  });

  const projectLabel = projectDisplayName
    ? `${projectDisplayName}[${input.project_slug}]`
    : input.project_slug || "Uncategorized";
  const bodyStr = input.body ? `\nbody: ${input.body}` : "";
  return `Idea saved: [${projectLabel}] ${input.title}${bodyStr}`;
}

async function execListIdeas(
  userId: string,
  input: { project_slug?: string }
): Promise<string> {
  const conditions = [eq(ideas.userId, userId), isNull(ideas.archivedAt)];

  if (input.project_slug) {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.slug, input.project_slug), eq(projects.userId, userId)))
      .limit(1);
    if (project) {
      conditions.push(eq(ideas.projectId, project.id));
    }
  }

  const result = await db
    .select({
      number: ideas.number,
      title: ideas.title,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(ideas)
    .leftJoin(projects, eq(ideas.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(ideas.createdAt));

  if (result.length === 0) {
    return "No ideas.";
  }

  const grouped: Record<string, { display: string; items: typeof result }> = {};
  for (const idea of result) {
    const slug = idea.projectSlug || "Uncategorized";
    const display = idea.projectName ? `${idea.projectName}[${slug}]` : slug;
    if (!grouped[slug]) grouped[slug] = { display, items: [] };
    grouped[slug].items.push(idea);
  }

  let message = `${result.length} ideas:\n`;
  for (const [, group] of Object.entries(grouped)) {
    message += `\n[${group.display}]\n`;
    for (const item of group.items) {
      message += `#${item.number}. ${item.title}\n`;
    }
  }

  return message;
}

async function execDeleteIdea(
  userId: string,
  input: { number?: number; keyword?: string }
): Promise<string> {
  const activeIdeas = await db
    .select({ id: ideas.id, number: ideas.number, title: ideas.title })
    .from(ideas)
    .where(and(eq(ideas.userId, userId), isNull(ideas.archivedAt)))
    .orderBy(desc(ideas.createdAt));

  let matched;
  if (input.number != null) {
    matched = activeIdeas.find((i) => i.number === input.number);
  } else if (input.keyword) {
    matched = activeIdeas.find((i) =>
      i.title.toLowerCase().includes(input.keyword!.toLowerCase())
    );
  }

  if (!matched) {
    return "Idea not found.";
  }

  await db.delete(ideas).where(eq(ideas.id, matched.id));
  return `Deleted idea: ${matched.title}`;
}

async function execConvertIdeaToTodo(
  userId: string,
  input: { number?: number; keyword?: string; priority?: string; deadline?: string }
): Promise<string> {
  const activeIdeas = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.userId, userId), isNull(ideas.archivedAt)))
    .orderBy(desc(ideas.createdAt));

  let matched;
  if (input.number != null) {
    matched = activeIdeas.find((i) => i.number === input.number);
  } else if (input.keyword) {
    matched = activeIdeas.find((i) =>
      i.title.toLowerCase().includes(input.keyword!.toLowerCase())
    );
  }

  if (!matched) {
    return "Idea not found.";
  }

  const todoNumber = await getNextTodoNumber(userId);
  await db.insert(todos).values({
    userId,
    number: todoNumber,
    content: matched.content,
    title: matched.title,
    memo: matched.body || null,
    projectId: matched.projectId,
    priority: (input.priority as "urgent" | "normal" | "low") || "normal",
    deadline: input.deadline ? new Date(input.deadline) : null,
    source: matched.source,
  });

  await db
    .update(ideas)
    .set({ archivedAt: new Date() })
    .where(eq(ideas.id, matched.id));

  return `Converted idea to todo: #${todoNumber} ${matched.title}`;
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
    case "add_idea":
      return execAddIdea(userId, toolInput as {
        title: string; body?: string; project_slug?: string; tags?: string[];
      });
    case "list_ideas":
      return execListIdeas(userId, toolInput as { project_slug?: string });
    case "delete_idea":
      return execDeleteIdea(userId, toolInput as { number?: number; keyword?: string });
    case "convert_idea_to_todo":
      return execConvertIdeaToTodo(userId, toolInput as {
        number?: number; keyword?: string; priority?: string; deadline?: string;
      });
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// --- Conversation history ---

function contentToText(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "[unknown]";
  const texts = content
    .filter((b): b is Anthropic.TextBlock => "type" in b && b.type === "text")
    .map((b) => b.text);
  return texts.join("\n") || "[tool interaction]";
}

async function saveMessages(
  userId: string,
  newMessages: Anthropic.MessageParam[]
): Promise<void> {
  for (const msg of newMessages) {
    await db.insert(chatMessages).values({
      userId,
      role: msg.role as "user" | "assistant",
      content: contentToText(msg.content),
      contentJson: JSON.stringify(msg.content),
    });
  }
}

async function getRecentMessages(
  userId: string,
  limit = 20
): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      contentJson: chatMessages.contentJson,
    })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  // Filter history to only simple text messages to avoid tool_use_id mismatch errors
  return rows.reverse().reduce<Anthropic.MessageParam[]>((acc, r) => {
    const parsed = r.contentJson ? JSON.parse(r.contentJson) : r.content;

    // Skip tool_result messages (user role with tool_result blocks)
    if (Array.isArray(parsed) && parsed.some((b: { type: string }) => b.type === "tool_result")) {
      return acc;
    }

    // For assistant messages with tool_use blocks, extract only text
    if (Array.isArray(parsed) && parsed.some((b: { type: string }) => b.type === "tool_use")) {
      const textOnly = parsed
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n");
      if (!textOnly) return acc;
      // Merge with previous if same role
      const last = acc[acc.length - 1];
      if (last && last.role === r.role) return acc;
      acc.push({ role: r.role as "user" | "assistant", content: textOnly });
      return acc;
    }

    // Plain text message — avoid consecutive same-role messages
    const text = typeof parsed === "string" ? parsed : r.content;
    const last = acc[acc.length - 1];
    if (last && last.role === r.role) return acc;
    acc.push({ role: r.role as "user" | "assistant", content: text });
    return acc;
  }, []);
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
  const messages: Anthropic.MessageParam[] = [...history];
  const newStartIndex = messages.length;

  messages.push({ role: "user", content: userMessage });

  console.log(`[AGENT] messages=${JSON.stringify(messages)}`);

  const MAX_ITERATIONS = 5;
  let finalResponse = "Max iterations reached. Please try again.";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );

    // Always push assistant response (includes tool_use blocks if any)
    messages.push({ role: "assistant", content: response.content });

    if (toolUseBlocks.length === 0) {
      finalResponse = textBlocks.map((b) => b.text).join("\n") || "Got it!";
      break;
    }

    // Process tool calls
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

    if (response.stop_reason === "end_turn" && textBlocks.length > 0) {
      finalResponse = textBlocks.map((b) => b.text).join("\n");
      break;
    }
  }

  // Save all new messages from this interaction
  await saveMessages(userId, messages.slice(newStartIndex));

  return finalResponse;
}
