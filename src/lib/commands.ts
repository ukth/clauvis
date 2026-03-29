import { db } from "./db";
import { todos, projects, users } from "./db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getNextTodoNumber } from "./db/utils";

const VALID_MODELS = ["haiku", "sonnet", "opus"] as const;

function h(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isCommand(text: string): boolean {
  return /^\/[a-zA-Z]/.test(text) && !text.startsWith("/start");
}

export async function handleCommand(
  text: string,
  userId: string
): Promise<string> {
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase().split("@")[0];
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
        return "Unknown command. Try /help for usage.";
    }
  } catch (error) {
    console.error("Command error:", error);
    return "Something went wrong. Please try again.";
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
    return "Usage: /add content #project\n\nLines after the first become a memo.";
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
    return "Please enter todo content.";
  }

  let projectId: string | null = null;
  let projectDisplay: string | null = null;

  if (projectSlug) {
    const project = await findProject(userId, projectSlug);
    if (!project) {
      return `Project "${projectSlug}" not found. Check /projects for the list.`;
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

  const label = projectDisplay ? ` <b>[${h(projectDisplay)}]</b>` : "";
  const memoStr = memo ? `\n📝 ${h(memo)}` : "";
  return `✅ <b>#${number}</b> ${h(title)}${label}${memoStr}`;
}

async function cmdList(args: string[], userId: string): Promise<string> {
  const projectSlug = args[0]?.toLowerCase();

  const conditions = [eq(todos.userId, userId), eq(todos.status, "pending")];

  if (projectSlug) {
    const project = await findProject(userId, projectSlug);
    if (!project) {
      return `Project "${projectSlug}" not found.`;
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
    return `${label}No todos! 🎉`;
  }

  // Group by project for display
  const grouped = new Map<string, { display: string; items: typeof result }>();
  for (const todo of result) {
    const key = todo.projectSlug || "__none__";
    const display = todo.projectName || todo.projectSlug || "Uncategorized";
    if (!grouped.has(key)) grouped.set(key, { display, items: [] });
    grouped.get(key)!.items.push(todo);
  }

  let msg = `📋 <b>${result.length} todos</b>\n`;

  for (const [, group] of grouped) {
    msg += `\n<b>[${h(group.display)}]</b>\n`;
    for (const item of group.items) {
      const priority = item.priority !== "normal" ? ` <i>[${item.priority}]</i>` : "";
      const deadline = item.deadline
        ? ` <i>(${item.deadline.toISOString().split("T")[0]})</i>`
        : "";
      msg += `<b>#${item.number}</b>. ${h(item.title)}${priority}${deadline}\n`;
    }
  }

  return msg;
}

async function cmdDone(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /done number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const todo = await findTodoByNumber(userId, num);
  if (!todo) {
    return `Todo #${num} not found.`;
  }
  if (todo.status === "done") {
    return `#${num} ${todo.title} is already done.`;
  }

  await db
    .update(todos)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(todos.id, todo.id));

  return `✅ Done: <b>#${num}</b> ${h(todo.title)}`;
}

async function cmdDel(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /del number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const todo = await findTodoByNumber(userId, num);
  if (!todo) {
    return `Todo #${num} not found.`;
  }

  await db.delete(todos).where(eq(todos.id, todo.id));

  return `🗑 Deleted: <b>#${num}</b> ${h(todo.title)}`;
}

async function cmdView(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /view number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const todo = await findTodoByNumber(userId, num);
  if (!todo) {
    return `Todo #${num} not found.`;
  }

  const project = todo.projectName || todo.projectSlug || "Uncategorized";
  const priority = todo.priority !== "normal" ? `\nPriority: ${todo.priority}` : "";
  const deadline = todo.deadline
    ? `\nDeadline: ${todo.deadline.toISOString().split("T")[0]}`
    : "";
  const memo = todo.memo ? `\n\n📝 ${todo.memo}` : "";
  const status = todo.status === "done" ? "Done" : "Pending";
  const completed = todo.completedAt
    ? `\nCompleted: ${todo.completedAt.toISOString().split("T")[0]}`
    : "";
  const created = todo.createdAt.toISOString().split("T")[0];

  return `<b>#${num} ${h(todo.title)}</b>

<b>Project:</b> ${h(project)}
<b>Status:</b> ${status}${priority}${deadline}
<b>Created:</b> ${created}${completed}
<b>Source:</b> ${todo.source}${memo}`;
}

async function cmdNewProject(
  args: string[],
  userId: string
): Promise<string> {
  if (args.length === 0) {
    return "Usage: /newproject slug [display name]";
  }

  const slug = args[0].toLowerCase();
  const name = args.slice(1).join(" ") || null;

  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
    .limit(1);

  if (existing) {
    return `Project "${existing.name || existing.slug}" already exists.`;
  }

  await db.insert(projects).values({ userId, slug, name });

  return `📁 Project created: ${name || slug}`;
}

async function cmdProjects(userId: string): Promise<string> {
  const allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId));

  if (allProjects.length === 0) {
    return "No projects yet. Create one with /newproject.";
  }

  let msg = `📁 <b>${allProjects.length} projects</b>\n\n`;
  for (const p of allProjects) {
    const display = p.name ? `<b>${h(p.name)}</b> <code>${h(p.slug)}</code>` : `<code>${h(p.slug)}</code>`;
    msg += `• ${display}\n`;
  }

  return msg;
}

async function cmdDelProject(
  args: string[],
  userId: string
): Promise<string> {
  if (args.length === 0) {
    return "Usage: /delproject slug";
  }

  const slug = args[0].toLowerCase();
  const [target] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
    .limit(1);

  if (!target) {
    return `Project "${slug}" not found.`;
  }

  await db.delete(projects).where(eq(projects.id, target.id));

  return `🗑 Project deleted: ${target.name || target.slug}`;
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
      return "Register your API Key first to use agent mode.\n\n/setkey sk-ant-...";
    }

    return `Current model: ${current}\n\nChange with: /model haiku | sonnet | opus`;
  }

  const [user] = await db
    .select({ encryptedAnthropicKey: users.encryptedAnthropicKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.encryptedAnthropicKey) {
    return "Register your API Key first to use agent mode.\n\n/setkey sk-ant-...";
  }

  const model = args[0].toLowerCase();
  if (!VALID_MODELS.includes(model as (typeof VALID_MODELS)[number])) {
    return "Available models: haiku, sonnet, opus";
  }

  await db
    .update(users)
    .set({ model })
    .where(eq(users.id, userId));

  return `🤖 Model changed: ${model}`;
}

function cmdHelp(): string {
  return `📌 Clauvis Commands

[Todos]
• /add content #project - Add todo (newline for memo)
• /list [project] - List todos
• /view number - View todo detail
• /done number - Complete todo
• /del number - Delete todo

[Projects]
• /newproject slug [name] - Create project
• /projects - List projects
• /delproject slug - Delete project

[Agent Mode]
• /setkey sk-ant-... - Register Claude API Key
• /delkey - Remove API Key
• /model haiku|sonnet|opus - Change model

[Examples]
/add fix image bug #mosun
/list mosun
/view 42
/done 42`;
}
