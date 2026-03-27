import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { todos, projects, users, chatMessages } from "./db/schema";
import { eq, and, desc } from "drizzle-orm";
import { esc } from "./telegram";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `당신은 할일 관리 비서 Clauvis입니다. 사용자의 메시지에 따라 적절한 도구를 사용하거나, 일상적인 대화에는 직접 응답하세요.

규칙:
- 한국어로 응답
- 친근하고 간결한 톤
- 할일 추가 시: 오타/줄임말 보정, 상대적 날짜를 절대 날짜로 변환, 사용자 메시지에서 맥락/이유/상세 내용을 memo에 적극적으로 채울 것
- 할일 추가 후 memo 내용을 보여주고 "수정하거나 추가할 내용이 있으면 알려주세요" 라고 안내
- 사용자가 기존 할일에 메모를 추가/수정하고 싶으면 update_todo로 처리
- 프로젝트 slug는 영문 소문자와 하이픈으로 구성
- 완료/삭제 시 번호가 주어지면 "프로젝트명 번호" 형식 (예: "모두의선생님 2번")으로 해석. 목록 조회 결과의 프로젝트별 번호 기준.
- 이모지 적절히 사용
- 일상 대화, 인사, 질문에는 도구 없이 직접 응답
- 도구 실행 결과를 사용자에게 전달할 때, 결과를 정확히 반영할 것. 임의로 내용을 만들거나 수정하지 말 것
- 도구 결과의 항목 수, 이름, 내용을 변경하지 말 것
- 응답은 텔레그램 MarkdownV2 형식으로 작성. 규칙: *볼드*, _이탤릭_, 특수문자(. ! - ( ) > # + = | { } ~)는 \\로 이스케이프. **가 아닌 *를 사용할 것`;

const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "list_todos",
    description: "할일 목록을 조회합니다. 프로젝트별로 그룹화하여 반환합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "특정 프로젝트의 할일만 조회할 때 프로젝트 slug",
        },
      },
      required: [],
    },
  },
  {
    name: "add_todo",
    description: "새 할일을 추가합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "할일 제목 (정리된 형태)" },
        project_slug: {
          type: "string",
          description: "프로젝트 slug (등록된 프로젝트 중 매칭되는 것)",
        },
        priority: {
          type: "string",
          enum: ["urgent", "normal", "low"],
          description: "우선순위",
        },
        deadline: {
          type: "string",
          description: "마감일 (YYYY-MM-DD 형식)",
        },
        memo: { type: "string", description: "부가 설명" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_todo",
    description: "할일을 완료 처리합니다. 프로젝트명과 번호, 또는 할일 제목의 일부로 지정합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "프로젝트 slug (번호로 지정할 때 필요)",
        },
        number: {
          type: "number",
          description: "프로젝트 내 할일 번호 (list_todos 결과의 번호)",
        },
        keyword: {
          type: "string",
          description: "할일 제목에 포함된 키워드 (번호 대신 사용)",
        },
      },
      required: [],
    },
  },
  {
    name: "delete_todo",
    description: "할일을 삭제합니다. 프로젝트명과 번호, 또는 할일 제목의 일부로 지정합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "프로젝트 slug (번호로 지정할 때 필요)",
        },
        number: {
          type: "number",
          description: "프로젝트 내 할일 번호",
        },
        keyword: {
          type: "string",
          description: "할일 제목에 포함된 키워드 (번호 대신 사용)",
        },
      },
      required: [],
    },
  },
  {
    name: "update_todo",
    description: "기존 할일의 메모, 제목, 우선순위, 기한 등을 수정합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_slug: {
          type: "string",
          description: "프로젝트 slug (번호로 지정할 때 필요)",
        },
        number: {
          type: "number",
          description: "프로젝트 내 할일 번호",
        },
        keyword: {
          type: "string",
          description: "할일 제목에 포함된 키워드 (번호 대신 사용)",
        },
        title: { type: "string", description: "변경할 제목" },
        memo: { type: "string", description: "변경할 메모" },
        priority: {
          type: "string",
          enum: ["urgent", "normal", "low"],
          description: "변경할 우선순위",
        },
        deadline: { type: "string", description: "변경할 기한 (YYYY-MM-DD)" },
      },
      required: [],
    },
  },
  {
    name: "list_projects",
    description: "등록된 프로젝트 목록을 조회합니다.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "add_project",
    description: "새 프로젝트를 추가합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "프로젝트 slug (영문 소문자, 하이픈)",
        },
        name: { type: "string", description: "프로젝트 표시 이름" },
        aliases: {
          type: "array",
          items: { type: "string" },
          description: "프로젝트 줄임말/별칭 목록",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "delete_project",
    description: "프로젝트를 삭제합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "삭제할 프로젝트의 slug" },
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
    return "할일이 없습니다.";
  }

  const grouped: Record<string, { display: string; items: typeof result }> = {};
  for (const todo of result) {
    const slug = todo.projectSlug || "미분류";
    const display = todo.projectName ? `${todo.projectName}[${slug}]` : slug;
    if (!grouped[slug]) grouped[slug] = { display, items: [] };
    grouped[slug].items.push(todo);
  }

  let message = `총 ${result.length}개의 할일:\n`;
  for (const [, group] of Object.entries(grouped)) {
    message += `\n[${group.display}]\n`;
    const items = group.items;
    let index = 1;
    for (const item of items) {
      const deadlineStr = item.deadline
        ? ` (기한: ${item.deadline.toISOString().split("T")[0]})`
        : "";
      const priorityStr = item.priority !== "normal" ? ` [${item.priority}]` : "";
      message += `${index}. ${item.title}${priorityStr}${deadlineStr}\n`;
      index++;
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

  await db.insert(todos).values({
    userId,
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
    : input.project_slug || "미분류";
  const memoStr = input.memo ? `\n메모: ${input.memo}` : "";
  return `할일 추가 완료: [${projectLabel}] ${input.title}${memoStr}`;
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
    return "해당하는 할일을 찾지 못했습니다.";
  }

  await db
    .update(todos)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(todos.id, todo.id));

  const remaining = pendingTodos.length - 1;
  return `완료: ${todo.title} (남은 할일 ${remaining}개)`;
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
    return "해당하는 할일을 찾지 못했습니다.";
  }

  await db.delete(todos).where(eq(todos.id, todo.id));
  return `삭제: ${todo.title}`;
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
    return "해당하는 할일을 찾지 못했습니다.";
  }

  const updateData: Record<string, unknown> = {};
  if (input.title) updateData.title = input.title;
  if (input.memo !== undefined) updateData.memo = input.memo;
  if (input.priority) updateData.priority = input.priority;
  if (input.deadline) updateData.deadline = new Date(input.deadline);

  await db.update(todos).set(updateData).where(eq(todos.id, todo.id));

  const fields = Object.keys(updateData).join(", ");
  return `수정 완료: ${todo.title} (${fields})`;
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

async function execListProjects(userId: string): Promise<string> {
  const allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  if (allProjects.length === 0) {
    return "등록된 프로젝트가 없습니다.";
  }

  let msg = `프로젝트 ${allProjects.length}개:\n`;
  for (const p of allProjects) {
    const aliasStr = p.aliases.length > 0 ? ` (${p.aliases.join(", ")})` : "";
    msg += `- ${p.name || p.slug}${aliasStr}\n`;
  }
  return msg;
}

async function execAddProject(
  userId: string,
  input: { slug: string; name?: string; aliases?: string[] }
): Promise<string> {
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, input.slug), eq(projects.userId, userId)))
    .limit(1);

  if (existing) {
    const displayName = existing.name || existing.slug;
    return `"${displayName}" 프로젝트는 이미 있습니다.`;
  }

  await db.insert(projects).values({
    userId,
    slug: input.slug,
    name: input.name || null,
    aliases: input.aliases || [],
  });

  const displayName = input.name || input.slug;
  const aliasStr = input.aliases?.length ? ` (alias: ${input.aliases.join(", ")})` : "";
  return `프로젝트 추가 완료: ${displayName}${aliasStr}`;
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
    return `"${input.slug}" 프로젝트를 찾지 못했습니다.`;
  }

  await db.delete(projects).where(eq(projects.id, target.id));
  return `프로젝트 삭제 완료: ${target.name || target.slug}`;
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
    case "list_projects":
      return execListProjects(userId);
    case "add_project":
      return execAddProject(userId, toolInput as {
        slug: string; name?: string; aliases?: string[];
      });
    case "delete_project":
      return execDeleteProject(userId, toolInput as { slug: string });
    default:
      return `알 수 없는 도구: ${toolName}`;
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

export async function runAgent(
  userMessage: string,
  userId: string
): Promise<string> {
  // Load project context for system prompt
  const projectList = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  const projectContext = projectList
    .map((p) => {
      const displayName = p.name ? ` (${p.name})` : "";
      const aliases = p.aliases.length > 0 ? `, aliases: ${p.aliases.join(", ")}` : "";
      return `- slug: ${p.slug}${displayName}${aliases}`;
    })
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `${SYSTEM_PROMPT}

오늘 날짜: ${today}

등록된 프로젝트:
${projectContext || "없음"}`;

  // Load conversation history
  const history = await getRecentMessages(userId);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
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
      return textBlocks.map((b) => b.text).join("\n") || "네, 알겠어요!";
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

  return "처리 중 최대 반복 횟수에 도달했어요. 다시 시도해주세요.";
}
