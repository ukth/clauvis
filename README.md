# Clauvis

Open source todo manager for developers — Telegram bot + Claude Code MCP integration.

## What is Clauvis?

Clauvis is a todo manager designed for developers who juggle multiple projects. Manage everything through Telegram or directly inside Claude Code via MCP — no context switching.

**Two modes:**

- **Command mode** (free) — Slash commands like `/add`, `/list`, `/done`. No API key needed.
- **Agent mode** (BYOK) — Register your own Anthropic API key for natural language interaction. Choose between Haiku, Sonnet, or Opus.

**Key features:**

- **Telegram bot** — Add, list, complete, and delete todos from your phone
- **Claude Code MCP** — Your todos show up automatically when you start coding, filtered by the current project
- **Natural language** — In agent mode, just type "fix image bug in my-app" and AI parses project, title, and priority
- **Multi-project** — Organize todos by project with automatic directory-based matching
- **Stable numbering** — Each todo gets a permanent `#number` that never changes
- **Multi-user** — Each user gets their own API key and isolated data
- **Self-hostable** — Deploy on your own infrastructure with zero cost

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

### Windows

On Windows, use [WSL (Windows Subsystem for Linux)](https://learn.microsoft.com/en-us/windows/wsl/install):

```powershell
wsl --install
```

After WSL is set up, run the same setup command inside your WSL terminal.

### 3. Register your projects

The setup script will ask for project directories. Point it to your workspace and it auto-detects git repos.

When you open Claude Code in a registered project directory, only that project's todos are shown.

### 4. (Optional) Enable agent mode

Register your Anthropic API key in Telegram:

```
/setkey sk-ant-...
```

Now you can manage todos with natural language. Choose your model with `/model haiku|sonnet|opus`.

## Commands

| Command | Description |
|---------|-------------|
| `/add content #project` | Add a todo (newline for memo) |
| `/list [project]` | List todos |
| `/view number` | View todo detail |
| `/done number` | Complete a todo |
| `/del number` | Delete a todo |
| `/newproject slug [name]` | Create a project |
| `/projects` | List projects |
| `/delproject slug` | Delete a project |
| `/setkey sk-ant-...` | Register API key (enables agent mode) |
| `/delkey` | Remove API key |
| `/model haiku\|sonnet\|opus` | Change AI model |
| `/help` | Show commands |

## Architecture

```
Telegram Bot  ←→  Next.js API (Vercel)  ←→  PostgreSQL (Neon)
Claude Code   ←→  MCP Server            ←→       ↑
                       ↓
                  Claude (BYOK — user's own API key)
```

## Tech Stack

- **Framework**: Next.js (App Router)
- **Database**: PostgreSQL (Neon) + Drizzle ORM
- **AI**: Claude (BYOK — user selects haiku/sonnet/opus)
- **Messaging**: Telegram Bot API
- **Encryption**: AES-256-GCM (API key storage)
- **Deployment**: Vercel
- **Integration**: MCP (Model Context Protocol) for Claude Code

## Self-hosting

### 1. Clone and install

```bash
git clone https://github.com/ukth/clauvis.git
cd clauvis/app
npm install
```

### 2. Create a database

Set up a PostgreSQL database (e.g. [Neon](https://neon.tech) free tier).

### 3. Create a Telegram bot

Message [@BotFather](https://t.me/BotFather) on Telegram and create a new bot. Save the bot token.

### 4. Set up environment variables

```
DATABASE_URL=postgresql://...
DATABASE_URL_UNPOOLED=postgresql://...
TELEGRAM_BOT_TOKEN=<your bot token>
TELEGRAM_WEBHOOK_SECRET=<random secret string>
ENCRYPTION_KEY=<32-byte hex key for API key encryption>
ADMIN_SECRET_KEY=<random secret for user creation API>
```

Generate `ENCRYPTION_KEY` with:
```bash
openssl rand -hex 32
```

Generate `TELEGRAM_WEBHOOK_SECRET` with:
```bash
openssl rand -hex 16
```

> Note: `ANTHROPIC_API_KEY` is not needed. All LLM calls use the user's own key (BYOK).

### 5. Push schema and deploy

```bash
npx drizzle-kit push
vercel --prod
```

### 6. Register Telegram webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<YOUR_URL>/api/telegram&secret_token=<SECRET>"
```

### 7. Set up Claude Code integration

Users can run the setup script with a custom URL:

```bash
CLAUVIS_URL=https://your-domain.com curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash
```

Or fork the repo and update the default URL in `scripts/setup.sh`.

## License

MIT
