import { db } from "./db";
import { todos, projects, users, ideas, workLogs } from "./db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getNextTodoNumber, getNextIdeaNumber, getNextWorkLogNumber } from "./db/utils";

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
      case "/setkey":
        return "Usage: /setkey sk-ant-...\n\nGet your key at console.anthropic.com";
      case "/delkey":
        return "Usage: /delkey\n\nRemoves your API Key and switches to command mode.";
      case "/idea":
        return await cmdAddIdea(args, userId, text);
      case "/ideas":
        return await cmdListIdeas(args, userId);
      case "/viewidea":
        return await cmdViewIdea(args, userId);
      case "/delidea":
        return await cmdDelIdea(args, userId);
      case "/idea2todo":
        return await cmdIdeaToTodo(args, userId);
      case "/log":
        return await cmdAddLog(args, userId, text);
      case "/logs":
        return await cmdListLogs(args, userId);
      case "/viewlog":
        return await cmdViewLog(args, userId);
      case "/dellog":
        return await cmdDelLog(args, userId);
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

// --- Idea command handlers ---

async function findIdeaByNumber(userId: string, num: number) {
  const [idea] = await db
    .select({
      id: ideas.id,
      number: ideas.number,
      title: ideas.title,
      body: ideas.body,
      tags: ideas.tags,
      source: ideas.source,
      projectId: ideas.projectId,
      projectName: projects.name,
      projectSlug: projects.slug,
      createdAt: ideas.createdAt,
      archivedAt: ideas.archivedAt,
    })
    .from(ideas)
    .leftJoin(projects, eq(ideas.projectId, projects.id))
    .where(and(eq(ideas.userId, userId), eq(ideas.number, num)))
    .limit(1);
  return idea || null;
}

async function cmdAddIdea(args: string[], userId: string, rawText: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /idea content #project\n\nLines after the first become the body.";
  }

  const commandRemoved = rawText.replace(/^\/idea(@\S+)?\s*/, "");
  const lines = commandRemoved.split("\n");
  const firstLine = lines[0].trim();
  const body = lines.slice(1).join("\n").trim() || null;

  let projectSlug: string | null = null;
  const titleParts: string[] = [];
  const tags: string[] = [];

  for (const word of firstLine.split(/\s+/)) {
    if (word.startsWith("#") && word.length > 1) {
      projectSlug = word.slice(1).toLowerCase();
    } else {
      titleParts.push(word);
    }
  }

  const title = titleParts.join(" ");
  if (!title) {
    return "Please enter idea content.";
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

  const number = await getNextIdeaNumber(userId);

  await db.insert(ideas).values({
    userId,
    number,
    content: title,
    title,
    body,
    projectId,
    tags,
    source: "telegram",
  });

  const label = projectDisplay ? ` <b>[${h(projectDisplay)}]</b>` : "";
  const bodyStr = body ? `\n💭 ${h(body)}` : "";
  return `💡 <b>#${number}</b> ${h(title)}${label}${bodyStr}`;
}

async function cmdListIdeas(args: string[], userId: string): Promise<string> {
  const projectSlug = args[0]?.toLowerCase();

  const conditions = [eq(ideas.userId, userId), isNull(ideas.archivedAt)];

  if (projectSlug) {
    const project = await findProject(userId, projectSlug);
    if (!project) {
      return `Project "${projectSlug}" not found.`;
    }
    conditions.push(eq(ideas.projectId, project.id));
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
    const label = projectSlug ? `[${projectSlug}] ` : "";
    return `${label}No ideas yet! 💡`;
  }

  const grouped = new Map<string, { display: string; items: typeof result }>();
  for (const idea of result) {
    const key = idea.projectSlug || "__none__";
    const display = idea.projectName || idea.projectSlug || "Uncategorized";
    if (!grouped.has(key)) grouped.set(key, { display, items: [] });
    grouped.get(key)!.items.push(idea);
  }

  let msg = `💡 <b>${result.length} ideas</b>\n`;

  for (const [, group] of grouped) {
    msg += `\n<b>[${h(group.display)}]</b>\n`;
    for (const item of group.items) {
      msg += `<b>#${item.number}</b>. ${h(item.title)}\n`;
    }
  }

  return msg;
}

async function cmdViewIdea(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /viewidea number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const idea = await findIdeaByNumber(userId, num);
  if (!idea) {
    return `Idea #${num} not found.`;
  }

  const project = idea.projectName || idea.projectSlug || "Uncategorized";
  const body = idea.body ? `\n\n💭 ${idea.body}` : "";
  const tags = idea.tags.length > 0 ? `\n<b>Tags:</b> ${idea.tags.map(t => h(t)).join(", ")}` : "";
  const created = idea.createdAt.toISOString().split("T")[0];

  return `💡 <b>#${num} ${h(idea.title)}</b>

<b>Project:</b> ${h(project)}
<b>Created:</b> ${created}
<b>Source:</b> ${idea.source}${tags}${body}`;
}

async function cmdDelIdea(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /delidea number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const idea = await findIdeaByNumber(userId, num);
  if (!idea) {
    return `Idea #${num} not found.`;
  }

  await db.delete(ideas).where(eq(ideas.id, idea.id));

  return `🗑 Deleted idea: <b>#${num}</b> ${h(idea.title)}`;
}

async function cmdIdeaToTodo(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /idea2todo number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const idea = await findIdeaByNumber(userId, num);
  if (!idea) {
    return `Idea #${num} not found.`;
  }

  const todoNumber = await getNextTodoNumber(userId);

  await db.insert(todos).values({
    userId,
    number: todoNumber,
    content: idea.title,
    title: idea.title,
    memo: idea.body || null,
    projectId: idea.projectId,
    source: idea.source,
  });

  // Archive the idea
  await db
    .update(ideas)
    .set({ archivedAt: new Date() })
    .where(eq(ideas.id, idea.id));

  const label = idea.projectName ? ` <b>[${h(idea.projectName)}]</b>` : "";
  return `✅ Idea → Todo: <b>#${todoNumber}</b> ${h(idea.title)}${label}`;
}

// --- Work Log command handlers ---

async function findWorkLogByNumber(userId: string, num: number) {
  const [log] = await db
    .select({
      id: workLogs.id,
      number: workLogs.number,
      title: workLogs.title,
      content: workLogs.content,
      date: workLogs.date,
      source: workLogs.source,
      projectId: workLogs.projectId,
      projectName: projects.name,
      projectSlug: projects.slug,
      createdAt: workLogs.createdAt,
    })
    .from(workLogs)
    .leftJoin(projects, eq(workLogs.projectId, projects.id))
    .where(and(eq(workLogs.userId, userId), eq(workLogs.number, num)))
    .limit(1);
  return log || null;
}

async function cmdAddLog(args: string[], userId: string, rawText: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /log title #project\n\nLines after the first become the content.";
  }

  const commandRemoved = rawText.replace(/^\/log(@\S+)?\s*/, "");
  const lines = commandRemoved.split("\n");
  const firstLine = lines[0].trim();
  const content = lines.slice(1).join("\n").trim();

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
    return "Please enter log title.";
  }

  if (!content) {
    return "Please enter log content on the next line.";
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

  const number = await getNextWorkLogNumber(userId);

  await db.insert(workLogs).values({
    userId,
    number,
    title,
    content,
    date: new Date(),
    projectId,
    source: "telegram",
  });

  const label = projectDisplay ? ` <b>[${h(projectDisplay)}]</b>` : "";
  return `📝 <b>#${number}</b> ${h(title)}${label}`;
}

async function cmdListLogs(args: string[], userId: string): Promise<string> {
  const projectSlug = args[0]?.toLowerCase();

  const conditions = [eq(workLogs.userId, userId)];

  if (projectSlug) {
    const project = await findProject(userId, projectSlug);
    if (!project) {
      return `Project "${projectSlug}" not found.`;
    }
    conditions.push(eq(workLogs.projectId, project.id));
  }

  const result = await db
    .select({
      number: workLogs.number,
      title: workLogs.title,
      date: workLogs.date,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(workLogs)
    .leftJoin(projects, eq(workLogs.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(workLogs.date))
    .limit(20);

  if (result.length === 0) {
    const label = projectSlug ? `[${projectSlug}] ` : "";
    return `${label}No work logs yet! 📝`;
  }

  const grouped = new Map<string, { display: string; items: typeof result }>();
  for (const log of result) {
    const key = log.projectSlug || "__none__";
    const display = log.projectName || log.projectSlug || "Uncategorized";
    if (!grouped.has(key)) grouped.set(key, { display, items: [] });
    grouped.get(key)!.items.push(log);
  }

  let msg = `📝 <b>${result.length} work logs</b>\n`;

  for (const [, group] of grouped) {
    msg += `\n<b>[${h(group.display)}]</b>\n`;
    for (const item of group.items) {
      const date = item.date.toISOString().split("T")[0];
      msg += `<b>#${item.number}</b>. ${date} ${h(item.title)}\n`;
    }
  }

  return msg;
}

async function cmdViewLog(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /viewlog number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const log = await findWorkLogByNumber(userId, num);
  if (!log) {
    return `Work log #${num} not found.`;
  }

  const project = log.projectName || log.projectSlug || "Uncategorized";
  const date = log.date.toISOString().split("T")[0];

  return `📝 <b>#${num} ${h(log.title)}</b>

<b>Project:</b> ${h(project)}
<b>Date:</b> ${date}
<b>Source:</b> ${log.source}

${h(log.content)}`;
}

async function cmdDelLog(args: string[], userId: string): Promise<string> {
  if (args.length === 0) {
    return "Usage: /dellog number";
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    return "Please enter a valid number.";
  }

  const log = await findWorkLogByNumber(userId, num);
  if (!log) {
    return `Work log #${num} not found.`;
  }

  await db.delete(workLogs).where(eq(workLogs.id, log.id));

  return `🗑 Deleted log: <b>#${num}</b> ${h(log.title)}`;
}

function cmdHelp(): string {
  return `📌 Clauvis Commands

[Todos]
• /add content #project - Add todo (newline for memo)
• /list [project] - List todos
• /view number - View todo detail
• /done number - Complete todo
• /del number - Delete todo

[Ideas]
• /idea content #project - Save idea (newline for body)
• /ideas [project] - List ideas
• /viewidea number - View idea detail
• /delidea number - Delete idea
• /idea2todo number - Convert idea to todo

[Work Logs]
• /log title #project - Save work log (newline for content)
• /logs [project] - List work logs
• /viewlog number - View log detail
• /dellog number - Delete log

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
/idea add dark mode support #mosun
/idea2todo 3
/list mosun
/done 42`;
}
