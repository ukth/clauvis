import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "./db";
import { todos, projects, users, chatMessages, ideas, transactions } from "./db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getNextTodoNumber, getNextIdeaNumber } from "./db/utils";
import { esc } from "./telegram";
import {
  formatMonthSummary,
  formatTransactionLine,
  isValidMonth,
  kstDateString,
  kstMonthString,
  kstTimeString,
  parseIsoWithOffset,
  listTransactions,
  summarizeMonth,
  updateTransactionMemo,
  addManualTransaction,
  deleteManualTransaction,
  excludeTransaction,
  includeTransaction,
  CATEGORIES,
} from "./ledger";

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
- CRITICAL: NEVER say a todo/idea was added, completed, or deleted without actually calling the tool AND receiving a success result. Wait for the tool result first, then confirm.
- When confirming additions, ALWAYS include the ticket number from the tool result (e.g. "#42 added"). A confirmation without a number is likely a hallucination.
- Once a tool returns a success result (e.g. "Added: #42 ..."), that item IS registered. Do NOT re-add it.
- Format with simple Markdown only: **bold** and \`code\` (converted for Telegram automatically). No tables, no links syntax, no italics.

Todo vs Idea:
- Todo: actionable tasks that need to be done (e.g. "fix bug", "add feature", "deploy")
- Idea: thoughts, inspirations, references, or not-yet-concrete plans (e.g. "maybe add dark mode", "look into X", "interesting approach for Y")
- When ambiguous, ask the user: "할일로 추가할까요, 아이디어로 메모할까요?"
- Keywords suggesting idea: "아이디어", "메모", "나중에 참고", "생각인데", "영감", "maybe", "idea"
- Keywords suggesting todo: "해야", "수정", "추가해줘", "고쳐", "fix", "add", "implement"

Spending ledger:
- The user's card transactions are synced into a ledger. Each transaction has a stable #number (separate from todo numbers). Use list_transactions / spending_summary for spending questions (months are YYYY-MM in KST).
- You may receive replies to a daily spending digest (an earlier assistant message listing "#번호 시각 가맹점 금액원 [카드]"). Map the reply to transaction(s) by #number, merchant, or amount and call update_transaction_memo (memo and/or category). If it matches multiple or no transactions, ask a short clarification instead of guessing.
- Replies to the digest refer to transactions, not todos — do not add todos for them unless explicitly asked.
- The user may log spending in natural language (e.g. "엄마한테 30만원 계좌이체", "현금 만원 붕어빵") → call add_transaction (resolve relative times like "어제", "오늘 점심" to a KST ISO datetime with +09:00), then confirm in one short line with the assigned #number. Ask only if the amount is missing or ambiguous.
- Use add_transaction ONLY for a completed past payment with an explicit amount and payee/description. Never for plans, reminders, questions, or hypotheticals ("내일 30만원 보내야 해", "얼마 썼지?") — use add_todo or reply directly instead.
- A reply to the digest, or any message containing a #number, is a memo/category update (update_transaction_memo), never a new entry.
- If the method is card, call list_transactions first; if a synced card row already matches (same amount, similar time/merchant), do NOT add it (it would be double-counted) and tell the user it is already recorded with its #number.
- If add_transaction reports a duplicate, do not retry; tell the user the existing #number.
- delete_transaction only works for manually added entries; synced card transactions cannot be deleted. Call it only when the user names a #number or asks to undo the entry just added, and always echo the #number in the confirmation.
- When the user asks to cancel/delete/remove a transaction ("지워", "삭제", "빼줘", "취소함"), act immediately — do not tell them to wait for a card cancellation: manual entries → delete_transaction; card rows (or if delete_transaction says it is a synced card transaction) → exclude_transaction, then say in one line that it was excluded from totals and can be restored. A later card-company cancellation SMS for an excluded charge is excluded automatically, so there is no double subtraction. "다시 넣어줘"/"복구" → include_transaction. Always echo the #number.
- Categories are a fixed list: 외식, 배달, 카페·간식, 장보기, 생필품, 쇼핑, 교통, 여행, 통신비, 구독·AI, 업무, 의료, 경조사·선물, 기타. New card rows are auto-classified by AI; the user reviews and corrects them. A reply like "#12 장보기" or "그거 외식 아니고 경조사" → update_transaction_memo with the category. A reply that is not a category name is a memo. Always set a category on add_transaction.
- A message from the web app may start with "[첨부 #N ...]": the user attached transaction #N, so "이거"/"this" refers to it.
- Identify the row by #number, or by a merchant/amount reference that matches exactly one recent transaction (call list_transactions to check). If it matches several or none, ask which #number instead of guessing.`;

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
  {
    name: "list_transactions",
    description: "List card transactions (spending ledger) for a KST month, newest first. Each line starts with the stable #number.",
    input_schema: {
      type: "object" as const,
      properties: {
        month: { type: "string", description: "Month in YYYY-MM (KST, default: current month)" },
        limit: { type: "number", description: "Max rows (default: 50)" },
      },
      required: [],
    },
  },
  {
    name: "spending_summary",
    description: "Monthly spending summary: net total, change vs previous month, by category, by card, top merchants.",
    input_schema: {
      type: "object" as const,
      properties: {
        month: { type: "string", description: "Month in YYYY-MM (KST, default: current month)" },
      },
      required: [],
    },
  },
  {
    name: "update_transaction_memo",
    description: "Set the memo and/or category of a card transaction by its #number.",
    input_schema: {
      type: "object" as const,
      properties: {
        number: { type: "number", description: "Transaction #number" },
        memo: { type: "string", description: "Memo" },
        category: { type: "string", enum: [...CATEGORIES], description: "Category" },
      },
      required: ["number"],
    },
  },
  {
    name: "add_transaction",
    description: "Manually log a spending entry not captured by card sync (bank transfer, cash, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Amount in KRW (positive integer)" },
        merchant: { type: "string", description: "Merchant or description (e.g. 엄마 용돈, 붕어빵)" },
        method: {
          type: "string",
          enum: ["transfer", "cash", "card", "other"],
          description: "Payment method: transfer(계좌이체, default), cash(현금), card, other",
        },
        occurred_at: { type: "string", description: "ISO datetime with +09:00 offset (default: now)" },
        category: { type: "string", enum: [...CATEGORIES], description: "Category (always set; pick the closest)" },
        memo: { type: "string", description: "Memo" },
      },
      required: ["amount", "merchant"],
    },
  },
  {
    name: "delete_transaction",
    description: "Delete a manually added transaction by #number. Synced card transactions cannot be deleted.",
    input_schema: {
      type: "object" as const,
      properties: {
        number: { type: "number", description: "Transaction #number" },
      },
      required: ["number"],
    },
  },
  {
    name: "exclude_transaction",
    description: "Exclude a transaction from all totals (e.g. a card charge the user wants ignored). Survives card sync; reversible with include_transaction.",
    input_schema: {
      type: "object" as const,
      properties: {
        number: { type: "number", description: "Transaction #number" },
        reason: { type: "string", description: "Why it is excluded (optional, ≤200 chars)" },
      },
      required: ["number"],
    },
  },
  {
    name: "include_transaction",
    description: "Restore a previously excluded transaction so it counts in totals again.",
    input_schema: {
      type: "object" as const,
      properties: {
        number: { type: "number", description: "Transaction #number" },
      },
      required: ["number"],
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
  return `Added: #${number} [${projectLabel}] ${input.title}${memoStr}`;
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

// --- Ledger execution functions ---

const listTransactionsInput = z.object({
  month: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const spendingSummaryInput = z.object({
  month: z.string().optional(),
});

const updateTransactionMemoInput = z.object({
  number: z.number().int().min(1),
  memo: z.string().max(1000).optional(),
  category: z.enum(CATEGORIES).optional(),
});

function invalidInput(error: z.ZodError): string {
  return `Invalid input: ${error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
}

async function execListTransactions(userId: string, rawInput: unknown): Promise<string> {
  const parsed = listTransactionsInput.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const month = parsed.data.month ?? kstMonthString();
  if (!isValidMonth(month)) return "Invalid month. Use YYYY-MM.";
  const rows = await listTransactions(userId, { month, limit: parsed.data.limit ?? 50 });
  if (rows.length === 0) return `No transactions in ${month}.`;
  return `${rows.length} transactions (${month}):\n${rows.map((tx) => formatTransactionLine(tx, { withDate: true })).join("\n")}`;
}

async function execSpendingSummary(userId: string, rawInput: unknown): Promise<string> {
  const parsed = spendingSummaryInput.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const month = parsed.data.month ?? kstMonthString();
  if (!isValidMonth(month)) return "Invalid month. Use YYYY-MM.";
  return formatMonthSummary(await summarizeMonth(userId, month));
}

async function execUpdateTransactionMemo(userId: string, rawInput: unknown): Promise<string> {
  const parsed = updateTransactionMemoInput.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const { number, memo, category } = parsed.data;
  if (memo === undefined && category === undefined) return "Provide memo or category.";
  const updated = await updateTransactionMemo(userId, number, { memo, category });
  if (!updated) return `Transaction #${number} not found.`;
  return `Updated: ${formatTransactionLine(updated, { withDate: true })}`;
}

const addTransactionInput = z.object({
  amount: z.number().int().min(1).max(2147483647),
  merchant: z.string().min(1).max(100),
  method: z.enum(["transfer", "cash", "card", "other"]).optional(),
  occurred_at: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  memo: z.string().max(1000).optional(),
});

const deleteTransactionInput = z.object({
  number: z.number().int().min(1),
});

async function execAddTransaction(userId: string, rawInput: unknown): Promise<string> {
  const parsed = addTransactionInput.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const { amount, merchant, method, occurred_at, category, memo } = parsed.data;
  const occurredAt = occurred_at ? parseIsoWithOffset(occurred_at) : undefined;
  if (occurredAt === null) return "Invalid occurred_at. Use ISO datetime with +09:00 offset (not in the future, not before 2000).";
  const result = await addManualTransaction(userId, { amount, merchant, method, occurredAt, category, memo });
  if (!result.ok) {
    return `Duplicate: not added. Same amount and merchant within 1 minute already exists: ${formatTransactionLine(result.existing, { withDate: true })}`;
  }
  return `Added: ${formatTransactionLine(result.tx, { withDate: true })}`;
}

async function execDeleteTransaction(userId: string, rawInput: unknown): Promise<string> {
  const parsed = deleteTransactionInput.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const result = await deleteManualTransaction(userId, parsed.data.number);
  if (!result.ok) {
    return result.reason === "not_found"
      ? `Transaction #${parsed.data.number} not found.`
      : `Transaction #${parsed.data.number} is a synced card transaction and cannot be deleted (the Mac sync would re-create it). Suggest adding a memo instead.`;
  }
  return `Deleted: ${formatTransactionLine(result.tx, { withDate: true })}`;
}

const excludeTransactionInput = z.object({
  number: z.number().int().min(1),
  reason: z.string().max(200).optional(),
});

const includeTransactionInput = z.object({
  number: z.number().int().min(1),
});

async function execExcludeTransaction(userId: string, rawInput: unknown): Promise<string> {
  const parsed = excludeTransactionInput.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const updated = await excludeTransaction(userId, parsed.data.number, parsed.data.reason);
  if (!updated) return `Transaction #${parsed.data.number} not found.`;
  return `Excluded from totals (restorable with include_transaction): ${formatTransactionLine(updated, { withDate: true })}`;
}

async function execIncludeTransaction(userId: string, rawInput: unknown): Promise<string> {
  const parsed = includeTransactionInput.safeParse(rawInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const updated = await includeTransaction(userId, parsed.data.number);
  if (!updated) return `Transaction #${parsed.data.number} not found.`;
  return `Included in totals again: ${formatTransactionLine(updated, { withDate: true })}`;
}

/** Ledger tools return errors as strings so a DB failure is reported to the model instead of aborting the turn. */
async function safeLedgerTool(run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (error) {
    console.error("[AGENT] ledger tool failed:", error);
    return `Error: ${error instanceof Error ? error.message : "unknown error"}`;
  }
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
    case "list_transactions":
      return safeLedgerTool(() => execListTransactions(userId, toolInput));
    case "spending_summary":
      return safeLedgerTool(() => execSpendingSummary(userId, toolInput));
    case "update_transaction_memo":
      return safeLedgerTool(() => execUpdateTransactionMemo(userId, toolInput));
    case "add_transaction":
      return safeLedgerTool(() => execAddTransaction(userId, toolInput));
    case "delete_transaction":
      return safeLedgerTool(() => execDeleteTransaction(userId, toolInput));
    case "exclude_transaction":
      return safeLedgerTool(() => execExcludeTransaction(userId, toolInput));
    case "include_transaction":
      return safeLedgerTool(() => execIncludeTransaction(userId, toolInput));
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

    // Convert tool_result messages to text summaries
    if (Array.isArray(parsed) && parsed.some((b: { type: string }) => b.type === "tool_result")) {
      const summary = parsed
        .filter((b: { type: string }) => b.type === "tool_result")
        .map((b: { content: unknown }) => {
          if (typeof b.content === "string") return b.content;
          if (Array.isArray(b.content)) {
            return b.content
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text: string }) => c.text)
              .join("");
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (!summary) return acc;
      const last = acc[acc.length - 1];
      if (last && last.role === "user") return acc;
      acc.push({ role: "user", content: `[Tool results]\n${summary}` });
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
    if (last && last.role === r.role) {
      // Merge plain text (e.g. a cron digest following an agent reply) so the newer message is not lost
      if (r.role === "assistant" && typeof last.content === "string") last.content = `${last.content}\n\n${text}`;
      return acc;
    }
    acc.push({ role: r.role as "user" | "assistant", content: text });
    return acc;
  }, []);
}

// --- Agent loop ---

const MODEL_MAP: Record<string, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

/** Snapshot of the user-editable fields of a transaction, used to undo agent edits from the web chat. */
export type LedgerTxState = {
  category: string | null;
  categorySource: string | null;
  memo: string | null;
  excluded: boolean;
  excludeReason: string | null;
};

/** A ledger change made by the agent during one turn. */
export type LedgerAgentAction =
  | { kind: "edit"; tool: string; number: number; merchant: string; amount: number | null; before: LedgerTxState; after: LedgerTxState }
  | { kind: "add"; number: number; merchant: string; amount: number | null }
  | { kind: "delete"; number: number; merchant: string; amount: number | null };

const LEDGER_EDIT_TOOLS = new Set(["update_transaction_memo", "exclude_transaction", "include_transaction"]);

async function readTxState(userId: string, number: number) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.number, number)))
    .limit(1);
  if (!row) return null;
  const state: LedgerTxState = {
    category: row.category,
    categorySource: row.categorySource,
    memo: row.memo,
    excluded: row.excludedAt != null,
    excludeReason: row.excludeReason,
  };
  return { row, state };
}

function sameState(a: LedgerTxState, b: LedgerTxState): boolean {
  return a.category === b.category && a.categorySource === b.categorySource && a.memo === b.memo
    && a.excluded === b.excluded && a.excludeReason === b.excludeReason;
}

/** Run a tool and, for ledger tools, record what changed so the web chat can show and undo it. */
async function executeToolTracked(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  userMessage: string,
  actions: LedgerAgentAction[]
): Promise<string> {
  const number = typeof input.number === "number" && Number.isSafeInteger(input.number) ? input.number : null;
  const before = number != null && (LEDGER_EDIT_TOOLS.has(name) || name === "delete_transaction")
    ? await readTxState(userId, number)
    : null;
  const result = await executeTool(name, input, userId, userMessage);

  if (before && number != null) {
    if (name === "delete_transaction") {
      if (!(await readTxState(userId, number))) {
        actions.push({ kind: "delete", number, merchant: before.row.merchant, amount: before.row.amount });
      }
    } else {
      const after = await readTxState(userId, number);
      if (after && !sameState(before.state, after.state)) {
        actions.push({ kind: "edit", tool: name, number, merchant: after.row.merchant, amount: after.row.amount, before: before.state, after: after.state });
      }
    }
  } else if (name === "add_transaction") {
    const added = /^Added: #(\d+)/.exec(result);
    const tx = added ? await readTxState(userId, Number(added[1])) : null;
    if (tx) actions.push({ kind: "add", number: tx.row.number, merchant: tx.row.merchant, amount: tx.row.amount });
  }
  return result;
}

export async function runAgent(
  userMessage: string,
  userId: string,
  anthropicApiKey: string,
  model?: string
): Promise<string> {
  return (await runAgentDetailed(userMessage, userId, anthropicApiKey, model)).reply;
}

/** Same agent turn as runAgent, plus the ledger changes it made (for the web chat's result cards). */
export async function runAgentDetailed(
  userMessage: string,
  userId: string,
  anthropicApiKey: string,
  model?: string
): Promise<{ reply: string; actions: LedgerAgentAction[] }> {
  const actions: LedgerAgentAction[] = [];
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

  const today = kstDateString();

  const systemPrompt = `${SYSTEM_PROMPT}

Today: ${today} (now ${kstTimeString(new Date())} KST)

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
      max_tokens: 4096,
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
      if (response.stop_reason === "max_tokens") finalResponse += "\n\n(길이 제한으로 여기서 잘렸어요)";
      break;
    }

    // Process tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await executeToolTracked(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        userId,
        userMessage,
        actions
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

  return { reply: finalResponse, actions };
}
