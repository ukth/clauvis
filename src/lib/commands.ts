import { db } from "./db";
import { todos, projects, users } from "./db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getNextTodoNumber } from "./db/utils";

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
      case "/view":
        return await cmdView(args, userId);
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


async function findTodoByNumber(userId: string, num: number) {
  const [todo] = await db
    .select({
      id: todos.id,
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
    .where(and(eq(todos.userId, userId), eq(todos.number, num)))
    .limit(1);
  return todo || null;
}

// --- Command handlers ---

async function cmdAdd(args: string[], userId: string, rawText: string): Promise<string> {
  if (args.length === 0) {
    return "사용법: /add 할일 내용 #프로젝트\n\n줄바꿈 이후는 메모로 저장됩니다.";
  }

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

  const number = await getNextTodoNumber(userId);

  await db.insert(todos).values({
    userId,
    number,
    content: title,
    title,
    memo,
    projectId,
    source: "telegram",
  });

  const label = projectDisplay ? ` [${projectDisplay}]` : "";
  const memoStr = memo ? `\n📝 ${memo}` : "";
  return `✅ #${number} ${title}${label}${memoStr}`;
}

async function cmdList(args: string[], userId: string): Promise<string> {
  const projectSlug = args[0]?.toLowerCase();

  const conditions = [eq(todos.userId, userId), eq(todos.status, "pending")];

  if (projectSlug) {
    const project = await findProject(userId, projectSlug);
    if (!project) {
      return `"${projectSlug}" 프로젝트를 찾을 수 없어요.`;
    }
    conditions.push(eq(todos.projectId, project.id));
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
    const label = projectSlug ? `[${projectSlug}] ` : "";
    return `${label}할일이 없어요! 🎉`;
  }

  // Group by project for display
  const grouped = new Map<string, { display: string; items: typeof result }>();
  for (const todo of result) {
    const key = todo.projectSlug || "__none__";
    const display = todo.projectName || todo.projectSlug || "미분류";
    if (!grouped.has(key)) grouped.set(key, { display, items: [] });
    grouped.get(key)!.items.push(todo);
  }

  let msg = `📋 할일 ${result.length}개\n`;

  for (const [, group] of grouped) {
    msg += `\n[${group.display}]\n`;
    for (const item of group.items) {
      const priority = item.priority !== "normal" ? ` [${item.priority}]` : "";
      const deadline = item.deadline
        ? ` (${item.deadline.toISOString().split("T")[0]})`
        : "";
      msg += `#${item.number}. ${item.title}${priority}${deadline}\n`;
    }
  }

  return msg;
}

async function cmdDone(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "사용법: /done 번호";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "올바른 번호를 입력해주세요.";
  }

  const todo = await findTodoByNumber(userId, num);
  if (!todo) {
    return `#${num} 할일을 찾을 수 없어요.`;
  }
  if (todo.status === "done") {
    return `#${num} ${todo.title}은(는) 이미 완료되었어요.`;
  }

  await db
    .update(todos)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(todos.id, todo.id));

  return `✅ 완료: #${num} ${todo.title}`;
}

async function cmdDel(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "사용법: /del 번호";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "올바른 번호를 입력해주세요.";
  }

  const todo = await findTodoByNumber(userId, num);
  if (!todo) {
    return `#${num} 할일을 찾을 수 없어요.`;
  }

  await db.delete(todos).where(eq(todos.id, todo.id));

  return `🗑 삭제: #${num} ${todo.title}`;
}

async function cmdView(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "사용법: /view 번호";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "올바른 번호를 입력해주세요.";
  }

  const todo = await findTodoByNumber(userId, num);
  if (!todo) {
    return `#${num} 할일을 찾을 수 없어요.`;
  }

  const project = todo.projectName || todo.projectSlug || "미분류";
  const priority = todo.priority !== "normal" ? `\n우선순위: ${todo.priority}` : "";
  const deadline = todo.deadline
    ? `\n기한: ${todo.deadline.toISOString().split("T")[0]}`
    : "";
  const memo = todo.memo ? `\n\n📝 ${todo.memo}` : "";
  const status = todo.status === "done" ? "완료" : "진행중";
  const completed = todo.completedAt
    ? `\n완료일: ${todo.completedAt.toISOString().split("T")[0]}`
    : "";
  const created = todo.createdAt.toISOString().split("T")[0];

  return `#${num} ${todo.title}

프로젝트: ${project}
상태: ${status}${priority}${deadline}
생성일: ${created}${completed}
출처: ${todo.source}${memo}`;
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
• /view 번호 - 할일 상세 조회
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
/view 42
/done 42`;
}
