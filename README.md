# Clauvis

AI-powered personal todo manager that lives where you work — Telegram, Claude Code, and the web.

## What is Clauvis?

Clauvis is a todo management service designed for developers who juggle multiple projects. Instead of switching between apps, you manage everything through natural language — in Telegram or directly inside Claude Code via MCP.

**Key features:**

- **Natural language input** — Just type "fix image bug in mosun" and the AI figures out the project, title, and priority
- **Telegram bot** — Add, list, complete, and delete todos from your phone
- **Claude Code MCP integration** — Your todos show up automatically when you start a coding session, filtered by the current project
- **Multi-project** — Organize todos by project with automatic directory-based matching
- **Conversational** — The bot remembers context, so "mark #2 as done" just works
- **Multi-user** — Each user gets their own API key and isolated data

## Quick Start

### 1. Get your API key

Message [@clauvis_ai_bot](https://t.me/clauvis_ai_bot) on Telegram and send `/start`.

### 2. Set up Claude Code integration

```bash
curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash
```

This installs:
- MCP server for Claude Code (todo tools available in every session)
- Session start hook (automatically shows your todos)
- Clauvis skill (Claude knows when and how to use todo tools)

### 3. Register your projects

The setup script will ask for project directories. Point it to your workspace and it auto-detects git repos.

When you open Claude Code in a registered project directory, only that project's todos are shown.

## Architecture

```
Telegram Bot  ←→  Next.js API (Vercel)  ←→  PostgreSQL (Neon)
Claude Code   ←→  MCP Server            ←→       ↑
                       ↓
                  Claude Sonnet (AI agent with tool-use loop)
```

## Tech Stack

- **Framework**: Next.js (App Router)
- **Database**: PostgreSQL (Neon) + Drizzle ORM
- **AI**: Claude Sonnet 4.6 (Telegram agent) / Claude Haiku 4.5 (API parsing)
- **Messaging**: Telegram Bot API
- **Deployment**: Vercel
- **Integration**: MCP (Model Context Protocol) for Claude Code

## Self-hosting

1. Clone the repo
2. Create a Neon database
3. Set up environment variables:

```
DATABASE_URL=postgresql://...
DATABASE_URL_UNPOOLED=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
ADMIN_SECRET_KEY=...
```

4. Push the schema: `npx drizzle-kit push`
5. Deploy to Vercel: `vercel --prod`
6. Register the Telegram webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<YOUR_URL>/api/telegram&secret_token=<SECRET>"
```

## License

MIT
