import { db } from "./db";
import { todos, projects, users } from "./db/schema";
import { eq, and, desc } from "drizzle-orm";

const VALID_MODELS = ["haiku", "sonnet", "opus"] as const;

export function isCommand(text: string): boolean {
  return /^\/[a-zA-Z]/.test(text) && !text.startsWith("/start");
}

export async function handleCommand(
  text: string,
  userId: string
): Promise<string> {
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase().split("@")[0]; // strip @botname
  const args = parts.slice(1);

  try {
    switch (command) {
      case "/add":
        return await cmdAdd(args, userId, text);
      case "/list":
        return await cmdList(args, userId);
      case "/done":
        return await cmdDone(args, userId);
      case "/del":
        return await cmdDel(args, userId);
      case "/newproject":
        return await cmdNewProject(args, userId);
      case "/projects":
        return await cmdProjects(userId);
      case "/delproject":
        return await cmdDelProject(args, userId);
      case "/model":
        return await cmdModel(args, userId);
      case "/help":
        return cmdHelp();
      default:
        return "알 수 없는 명령어예요. /help 로 사용법을 확인하세요.";
    }
  } catch (error) {
    console.error("Command error:", error);
    return "명령어 처리 중 오류가 발생했어요.";
  }
}

// --- Shared helpers ---

async function findProject(userId: string, slugOrAlias: string) {
  const [bySlug] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slugOrAlias), eq(projects.userId, userId)))
    .limit(1);

  if (bySlug) return bySlug;

  // Try alias or name match
  const allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  return (
    allProjects.find(
      (p) => p.name && p.name.toLowerCase() === slugOrAlias
    ) || null
  );
}

interface PendingTodo {
  id: string;
  title: string;
  priority: "urgent" | "normal" | "low";
  deadline: Date | null;
  projectName: string | null;
  projectSlug: string | null;
}

async function getGroupedPendingTodos(userId: string) {
  const result = await db
    .select({
      id: todos.id,
      title: todos.title,
      priority: todos.priority,
      deadline: todos.deadline,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
    .orderBy(desc(todos.createdAt));

  // Group by project, preserving insertion order
  const grouped = new Map<
    string,
    { display: string; items: PendingTodo[] }
  >();
  for (const todo of result) {
    const key = todo.projectSlug || "__none__";
    const display = todo.projectName || todo.projectSlug || "미분류";
    if (!grouped.has(key)) grouped.set(key, { display, items: [] });
    grouped.get(key)!.items.push(todo);
  }

  // Flatten in grouped order for consistent global numbering
  const ordered: PendingTodo[] = [];
  for (const [, group] of grouped) {
    ordered.push(...group.items);
  }

  return { grouped, ordered };
}

// --- Command handlers ---

async function cmdAdd(args: string[], userId: string, rawText: string): Promise<string> {
  if (args.length === 0) {
    return "사용법: /add 할일 내용 #프로젝트\n\n줄바꿈 이후는 메모로 저장됩니다.";
  }

  // Split by newline: first line = title + project, rest = memo
  const commandRemoved = rawText.replace(/^\/add(@\S+)?\s*/, "");
  const lines = commandRemoved.split("\n");
  const firstLine = lines[0].trim();
  const memo = lines.slice(1).join("\n").trim() || null;

  let projectSlug: string | null = null;
  const titleParts: string[] = [];

  for (const word of firstLine.split(/\s+/)) {
    if (word.startsWith("#") && word.length > 1) {
      projectSlug = word.slice(1).toLowerCase();
    } else {
      titleParts.push(word);
    }
  }

  const title = titleParts.join(" ");
  if (!title) {
    return "할일 내용을 입력해주세요.";
  }

  let projectId: string | null = null;
  let projectDisplay: string | null = null;

  if (projectSlug) {
    const project = await findProject(userId, projectSlug);
    if (!project) {
      return `"${projectSlug}" 프로젝트를 찾을 수 없어요. /projects 로 목록을 확인하세요.`;
    }
    projectId = project.id;
    projectDisplay = project.name || project.slug;
  }

  await db.insert(todos).values({
    userId,
    content: title,
    title,
    memo,
    projectId,
    source: "telegram",
  });

  const label = projectDisplay ? ` [${projectDisplay}]` : "";
  const memoStr = memo ? `\n📝 ${memo}` : "";
  return `✅ ${title}${label}${memoStr}`;
}

async function cmdList(args: string[], userId: string): Promise<string> {
  const projectSlug = args[0]?.toLowerCase();

  if (projectSlug) {
    const project = await findProject(userId, projectSlug);
    if (!project) {
      return `"${projectSlug}" 프로젝트를 찾을 수 없어요.`;
    }

    const result = await db
      .select({
        id: todos.id,
        title: todos.title,
        priority: todos.priority,
        deadline: todos.deadline,
      })
      .from(todos)
      .where(
        and(
          eq(todos.userId, userId),
          eq(todos.status, "pending"),
          eq(todos.projectId, project.id)
        )
      )
      .orderBy(desc(todos.createdAt));

    if (result.length === 0) {
      return `[${project.name || project.slug}] 할일이 없어요! 🎉`;
    }

    let msg = `📋 [${project.name || project.slug}] 할일 ${result.length}개\n\n`;
    result.forEach((item, i) => {
      const priority =
        item.priority !== "normal" ? ` [${item.priority}]` : "";
      const deadline = item.deadline
        ? ` (${item.deadline.toISOString().split("T")[0]})`
        : "";
      msg += `${i + 1}. ${item.title}${priority}${deadline}\n`;
    });
    return msg;
  }

  // All todos, grouped by project
  const { grouped, ordered } = await getGroupedPendingTodos(userId);

  if (ordered.length === 0) {
    return "할일이 없어요! 🎉";
  }

  let globalNum = 1;
  let msg = `📋 할일 ${ordered.length}개\n`;

  for (const [, group] of grouped) {
    msg += `\n[${group.display}]\n`;
    for (const item of group.items) {
      const priority =
        item.priority !== "normal" ? ` [${item.priority}]` : "";
      const deadline = item.deadline
        ? ` (${item.deadline.toISOString().split("T")[0]})`
        : "";
      msg += `${globalNum}. ${item.title}${priority}${deadline}\n`;
      globalNum++;
    }
  }

  return msg;
}

async function cmdDone(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "사용법: /done 번호 또는 /done 프로젝트 번호";
  }

  const { grouped, ordered } = await getGroupedPendingTodos(userId);

  if (ordered.length === 0) {
    return "할일이 없어요.";
  }

  const todo = resolveTarget(args, grouped, ordered);
  if (!todo) {
    return "해당 번호의 할일을 찾을 수 없어요. /list 로 확인하세요.";
  }

  await db
    .update(todos)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(todos.id, todo.id));

  return `✅ 완료: ${todo.title} (남은 할일 ${ordered.length - 1}개)`;
}

async function cmdDel(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "사용법: /del 번호 또는 /del 프로젝트 번호";
  }

  const { grouped, ordered } = await getGroupedPendingTodos(userId);

  if (ordered.length === 0) {
    return "할일이 없어요.";
  }

  const todo = resolveTarget(args, grouped, ordered);
  if (!todo) {
    return "해당 번호의 할일을 찾을 수 없어요. /list 로 확인하세요.";
  }

  await db.delete(todos).where(eq(todos.id, todo.id));

  return `🗑 삭제: ${todo.title}`;
}

function resolveTarget(
  args: string[],
  grouped: Map<string, { display: string; items: PendingTodo[] }>,
  ordered: PendingTodo[]
): PendingTodo | null {
  // /done 3 (global number)
  if (args.length === 1) {
    const num = parseInt(args[0]);
    if (!isNaN(num) && num >= 1 && num <= ordered.length) {
      return ordered[num - 1];
    }
    return null;
  }

  // /done project 2 (project-scoped number)
  if (args.length >= 2) {
    const slug = args[0].toLowerCase();
    const num = parseInt(args[1]);
    if (isNaN(num) || num < 1) return null;

    const group = grouped.get(slug);
    if (group && num <= group.items.length) {
      return group.items[num - 1];
    }
    return null;
  }

  return null;
}

async function cmdNewProject(
  args: string[],
  userId: string
): Promise<string> {
  if (args.length === 0) {
    return "사용법: /newproject slug [표시이름]";
  }

  const slug = args[0].toLowerCase();
  const name = args.slice(1).join(" ") || null;

  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
    .limit(1);

  if (existing) {
    return `"${existing.name || existing.slug}" 프로젝트가 이미 있어요.`;
  }

  await db.insert(projects).values({ userId, slug, name });

  return `📁 프로젝트 생성: ${name || slug}`;
}

async function cmdProjects(userId: string): Promise<string> {
  const allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  if (allProjects.length === 0) {
    return "등록된 프로젝트가 없어요. /newproject 로 추가하세요.";
  }

  let msg = `📁 프로젝트 ${allProjects.length}개\n\n`;
  for (const p of allProjects) {
    const display = p.name ? `${p.name} [${p.slug}]` : p.slug;
    msg += `• ${display}\n`;
  }

  return msg;
}

async function cmdDelProject(
  args: string[],
  userId: string
): Promise<string> {
  if (args.length === 0) {
    return "사용법: /delproject slug";
  }

  const slug = args[0].toLowerCase();
  const [target] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
    .limit(1);

  if (!target) {
    return `"${slug}" 프로젝트를 찾을 수 없어요.`;
  }

  await db.delete(projects).where(eq(projects.id, target.id));

  return `🗑 프로젝트 삭제: ${target.name || target.slug}`;
}

async function cmdModel(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    const [user] = await db
      .select({ model: users.model, encryptedAnthropicKey: users.encryptedAnthropicKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const current = user?.model || "sonnet";
    const hasKey = !!user?.encryptedAnthropicKey;

    if (!hasKey) {
      return `에이전트 모드를 사용하려면 먼저 API Key를 등록해주세요.\n\n/setkey sk-ant-...`;
    }

    return `현재 모델: ${current}\n\n변경하려면: /model haiku | sonnet | opus`;
  }

  const [user] = await db
    .select({ encryptedAnthropicKey: users.encryptedAnthropicKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.encryptedAnthropicKey) {
    return `에이전트 모드를 사용하려면 먼저 API Key를 등록해주세요.\n\n/setkey sk-ant-...`;
  }

  const model = args[0].toLowerCase();
  if (!VALID_MODELS.includes(model as (typeof VALID_MODELS)[number])) {
    return `사용 가능한 모델: haiku, sonnet, opus`;
  }

  await db
    .update(users)
    .set({ model })
    .where(eq(users.id, userId));

  return `🤖 모델 변경: ${model}`;
}

function cmdHelp(): string {
  return `📌 Clauvis 명령어

[할일 관리]
• /add 할일 내용 #프로젝트 - 할일 추가 (줄바꿈 후 메모)
• /list [프로젝트] - 할일 목록
• /done 번호 - 할일 완료
• /del 번호 - 할일 삭제

[프로젝트 관리]
• /newproject slug [이름] - 프로젝트 생성
• /projects - 프로젝트 목록
• /delproject slug - 프로젝트 삭제

[에이전트 모드]
• /setkey sk-ant-... - Claude API Key 등록
• /delkey - API Key 삭제 (명령어 모드로 전환)
• /model haiku|sonnet|opus - 모델 변경

[예시]
/add 이미지 버그 수정 #mosun
/list mosun
/done 1
/done mosun 2`;
}
