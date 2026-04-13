#!/bin/bash
# Clauvis Setup Script
# Usage: curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash

set -e

CLAUVIS_URL="${CLAUVIS_URL:-https://clauvis.backproach.dev}"

# --- Detect installed AI tools ---
HAS_CLAUDE=false
HAS_CODEX=false
command -v claude &>/dev/null && HAS_CLAUDE=true
command -v codex &>/dev/null && HAS_CODEX=true

if [ "$HAS_CLAUDE" = "false" ] && [ "$HAS_CODEX" = "false" ]; then
  echo "❌ Neither Claude Code nor Codex CLI found. Please install one first."
  exit 1
fi

TOOLS=""
[ "$HAS_CLAUDE" = "true" ] && TOOLS="Claude Code"
[ "$HAS_CODEX" = "true" ] && TOOLS="${TOOLS:+$TOOLS, }Codex CLI"

echo "🔧 Clauvis Setup (detected: $TOOLS)"
echo ""
echo "If you don't have an API Key, get one from the Telegram bot:"
echo "  👉 https://t.me/clauvis_ai_bot → send /start"
echo ""

# --- API Key input ---
read -p "Enter your API Key (clv_...): " API_KEY < /dev/tty

if [[ ! "$API_KEY" =~ ^clv_ ]]; then
  echo "❌ Invalid API Key. Must start with clv_."
  exit 1
fi

# Verify API Key
VERIFY=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $API_KEY" "$CLAUVIS_URL/api/projects")
if [ "$VERIFY" != "200" ]; then
  echo "❌ API Key verification failed. Get one from the Telegram bot with /start."
  exit 1
fi

echo "✓ API Key verified"


# ============================================================
# Claude Code Setup
# ============================================================
if [ "$HAS_CLAUDE" = "true" ]; then
  echo ""
  echo "--- Claude Code ---"

  CLAUDE_DIR="$HOME/.claude"
  SETTINGS_FILE="$CLAUDE_DIR/settings.json"
  CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
  HOOK_DIR="$CLAUDE_DIR/clauvis"
  HOOK_FILE="$HOOK_DIR/hook.sh"

  # Install hook script
  mkdir -p "$HOOK_DIR"

  cat > "$HOOK_FILE" << 'HOOKSCRIPT'
#!/bin/bash
# Clauvis session start hook - shows todos on first message

PPID_LOCK="/tmp/clauvis-session-$PPID"
if [ -f "$PPID_LOCK" ]; then
  exit 0
fi
touch "$PPID_LOCK"

SETTINGS="$HOME/.claude.json"
API_KEY=$(python3 -c "
import json, os
with open(os.path.expanduser('$SETTINGS')) as f:
    s = json.load(f)
h = s.get('mcpServers',{}).get('clauvis',{}).get('headers',{})
print(h.get('Authorization','').replace('Bearer ',''))
" 2>/dev/null)

[ -z "$API_KEY" ] && exit 0

URL=$(python3 -c "
import json, os
with open(os.path.expanduser('$SETTINGS')) as f:
    s = json.load(f)
u = s.get('mcpServers',{}).get('clauvis',{}).get('url','')
print(u.replace('/api/mcp',''))
" 2>/dev/null)

[ -z "$URL" ] && exit 0

# 1. Check project name from .clauvis/config.md
PROJECT=""
if [ -f ".clauvis/config.md" ]; then
  PROJECT=$(grep -m1 "clauvis-project:" .clauvis/config.md 2>/dev/null | sed 's/.*clauvis-project:[[:space:]]*//')
fi

# 2. If not found, auto-match by current directory
if [ -z "$PROJECT" ]; then
  CWD=$(pwd)
  MATCH=$(curl -s -H "Authorization: Bearer $API_KEY" "$URL/api/projects" 2>/dev/null | python3 -c "
import sys, json
cwd = '$CWD'
projects = json.load(sys.stdin)
for p in projects:
    dp = p.get('directoryPath')
    if dp and (cwd == dp or cwd.startswith(dp + '/')):
        print(p['slug'])
        break
" 2>/dev/null)
  if [ -n "$MATCH" ]; then
    PROJECT="$MATCH"
    mkdir -p .clauvis
    echo "clauvis-project: $PROJECT" > .clauvis/config.md
  fi
fi

if [ -n "$PROJECT" ]; then
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$URL/api/todos?status=pending&project=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PROJECT'))")" 2>/dev/null)
else
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$URL/api/todos?status=pending" 2>/dev/null)
fi

COUNT=$(echo "$TODOS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ -z "$COUNT" ] || [ "$COUNT" = "0" ] && exit 0

echo "<clauvis-todos>"
[ -n "$PROJECT" ] && echo "${COUNT} todos for project '$PROJECT':" || echo "${COUNT} todos:"
echo "$TODOS" | python3 -c "
import sys, json
todos = json.load(sys.stdin)
grouped = {}
for t in todos:
    p = t.get('projectName') or t.get('projectSlug') or 'Uncategorized'
    grouped.setdefault(p, []).append(t)
i = 1
for proj, items in grouped.items():
    print(f'\n[{proj}]')
    for t in items:
        d = f\" (deadline: {t['deadline'][:10]})\" if t.get('deadline') else ''
        print(f'  {i}. {t[\"title\"]}{d}')
        i += 1
" 2>/dev/null
echo ""
echo "Briefly summarize the todo list above for the user."
echo "</clauvis-todos>"
HOOKSCRIPT

  chmod +x "$HOOK_FILE"
  echo "✓ Hook script installed"

  # Add MCP server
  claude mcp remove clauvis --scope user 2>/dev/null || true
  claude mcp add --transport http --scope user clauvis "$CLAUVIS_URL/api/mcp" \
    --header "Authorization: Bearer $API_KEY" 2>/dev/null
  echo "✓ MCP server configured"

  # Add hook to settings.json
  mkdir -p "$CLAUDE_DIR"
  python3 -c "
import json, os

path = '$SETTINGS_FILE'
if os.path.exists(path):
    with open(path, 'r') as f:
        settings = json.load(f)
else:
    settings = {}

settings.setdefault('hooks', {})
existing = settings['hooks'].get('UserPromptSubmit', [])
existing = [
    entry for entry in existing
    if not any('clauvis' in h.get('command', '') for h in entry.get('hooks', []))
]
existing.append({
    'matcher': '',
    'hooks': [{
        'type': 'command',
        'command': '$HOOK_DIR/hook.sh'
    }]
})
settings['hooks']['UserPromptSubmit'] = existing

with open(path, 'w') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
print('✓ Hook settings configured')
"

  # Install Clauvis skill
  SKILL_DIR="$CLAUDE_DIR/skills/clauvis"
  mkdir -p "$SKILL_DIR"
  curl -sL "https://raw.githubusercontent.com/ukth/clauvis/main/scripts/clauvis-skill.md" > "$SKILL_DIR/SKILL.md"
  echo "✓ Clauvis skill installed"

  # Add instructions to CLAUDE.md
  CLAUVIS_LINE="## Clauvis
- Todos are auto-injected at session start. Summarize them for the user.
- After completing a milestone (commit, feature, bug fix), ask: \"Save a work log?\" If yes, use add_work_log MCP tool.
- If the work relates to an existing todo, ask: \"Mark as done in Clauvis?\" If yes, use complete_todo MCP tool."

  if [ -f "$CLAUDE_MD" ]; then
    if ! grep -q "Clauvis" "$CLAUDE_MD"; then
      echo "" >> "$CLAUDE_MD"
      echo "$CLAUVIS_LINE" >> "$CLAUDE_MD"
      echo "✓ CLAUDE.md updated"
    else
      echo "✓ CLAUDE.md already has Clauvis config"
    fi
  else
    echo "$CLAUVIS_LINE" > "$CLAUDE_MD"
    echo "✓ CLAUDE.md created"
  fi
fi


# ============================================================
# Codex CLI Setup
# ============================================================
if [ "$HAS_CODEX" = "true" ]; then
  echo ""
  echo "--- Codex CLI ---"

  CODEX_DIR="$HOME/.codex"
  CODEX_CONFIG="$CODEX_DIR/config.toml"
  CODEX_HOOKS="$CODEX_DIR/hooks.json"
  CODEX_HOOK_DIR="$CODEX_DIR/clauvis"
  CODEX_HOOK_FILE="$CODEX_HOOK_DIR/hook.sh"
  CODEX_AGENTS_MD="$CODEX_DIR/AGENTS.md"

  # Install Codex hook script
  # Reads API key from config.toml at runtime (bearer_token_env_var is unreliable)
  mkdir -p "$CODEX_HOOK_DIR"

  cat > "$CODEX_HOOK_FILE" << 'CODEXHOOK'
#!/bin/bash
# Clauvis session hook for Codex CLI

PPID_LOCK="/tmp/clauvis-codex-session-$PPID"
if [ -f "$PPID_LOCK" ]; then
  exit 0
fi
touch "$PPID_LOCK"

# Read API key from config.toml http_headers
API_KEY=$(python3 -c "
import re, os
path = os.path.expanduser('~/.codex/config.toml')
try:
    with open(path) as f:
        content = f.read()
    m = re.search(r'\[mcp_servers\.clauvis\][^\[]*Authorization\s*=\s*\"Bearer ([^\"]+)\"', content, re.DOTALL)
    if m:
        print(m.group(1))
except:
    pass
" 2>/dev/null)

[ -z "$API_KEY" ] && exit 0

CLAUVIS_URL="${CLAUVIS_URL:-https://clauvis.backproach.dev}"

# Check project from .clauvis/config.md or auto-detect by directory
PROJECT=""
if [ -f ".clauvis/config.md" ]; then
  PROJECT=$(grep -m1 "clauvis-project:" .clauvis/config.md 2>/dev/null | sed 's/.*clauvis-project:[[:space:]]*//')
fi

if [ -z "$PROJECT" ]; then
  CWD=$(pwd)
  MATCH=$(curl -s -H "Authorization: Bearer $API_KEY" "$CLAUVIS_URL/api/projects" 2>/dev/null | python3 -c "
import sys, json
cwd = '$CWD'
projects = json.load(sys.stdin)
for p in projects:
    dp = p.get('directoryPath')
    if dp and (cwd == dp or cwd.startswith(dp + '/')):
        print(p['slug'])
        break
" 2>/dev/null)
  if [ -n "$MATCH" ]; then
    PROJECT="$MATCH"
    mkdir -p .clauvis
    echo "clauvis-project: $PROJECT" > .clauvis/config.md
  fi
fi

if [ -n "$PROJECT" ]; then
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$CLAUVIS_URL/api/todos?status=pending&project=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PROJECT'))")" 2>/dev/null)
else
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$CLAUVIS_URL/api/todos?status=pending" 2>/dev/null)
fi

COUNT=$(echo "$TODOS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ -z "$COUNT" ] || [ "$COUNT" = "0" ] && exit 0

echo "<clauvis-todos>"
[ -n "$PROJECT" ] && echo "${COUNT} todos for project '$PROJECT':" || echo "${COUNT} todos:"
echo "$TODOS" | python3 -c "
import sys, json
todos = json.load(sys.stdin)
grouped = {}
for t in todos:
    p = t.get('projectName') or t.get('projectSlug') or 'Uncategorized'
    grouped.setdefault(p, []).append(t)
i = 1
for proj, items in grouped.items():
    print(f'\n[{proj}]')
    for t in items:
        d = f\" (deadline: {t['deadline'][:10]})\" if t.get('deadline') else ''
        print(f'  {i}. {t[\"title\"]}{d}')
        i += 1
" 2>/dev/null
echo ""
echo "Briefly summarize the todo list above for the user."
echo "</clauvis-todos>"
CODEXHOOK

  chmod +x "$CODEX_HOOK_FILE"
  echo "✓ Hook script installed"

  # Patch config.toml: add/update [mcp_servers.clauvis] with http_headers
  # Handles migration from old bearer_token_env_var setup
  python3 -c "
import re, os

config_path = os.path.expanduser('$CODEX_CONFIG')
api_key = '$API_KEY'
url = '$CLAUVIS_URL'

new_block = '[mcp_servers.clauvis]\nurl = \"' + url + '/api/mcp\"\nhttp_headers = { Authorization = \"Bearer ' + api_key + '\" }'

if os.path.exists(config_path):
    with open(config_path) as f:
        content = f.read()

    if re.search(r'\[mcp_servers\.clauvis\]', content):
        # Replace existing block (up to next [section] or EOF)
        content = re.sub(
            r'\[mcp_servers\.clauvis\][^\[]*',
            new_block + '\n\n',
            content,
            flags=re.DOTALL
        )
        print('✓ MCP server updated (migrated to http_headers)')
    else:
        content = content.rstrip('\n') + '\n\n' + new_block + '\n'
        print('✓ MCP server configured')

    with open(config_path, 'w') as f:
        f.write(content)
else:
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, 'w') as f:
        f.write(new_block + '\n')
    print('✓ MCP server configured (new config.toml)')
"

  # Update hooks.json: add UserPromptSubmit hook (idempotent)
  python3 -c "
import json, os

hooks_path = '$CODEX_HOOKS'
hook_cmd = '$CODEX_HOOK_FILE'

if os.path.exists(hooks_path):
    with open(hooks_path) as f:
        data = json.load(f)
else:
    data = {'hooks': {}}

data.setdefault('hooks', {})
existing = data['hooks'].get('UserPromptSubmit', [])

# Remove old clauvis entries
existing = [
    entry for entry in existing
    if not any('clauvis' in h.get('command', '') for h in entry.get('hooks', []))
]
existing.append({
    'matcher': '',
    'hooks': [{
        'type': 'command',
        'command': hook_cmd,
        'statusMessage': 'Loading Clauvis todos'
    }]
})
data['hooks']['UserPromptSubmit'] = existing

with open(hooks_path, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print('✓ Hook settings configured')
"

  # Install Clauvis skill for Codex
  CODEX_SKILL_DIR="$CODEX_DIR/skills/clauvis"
  mkdir -p "$CODEX_SKILL_DIR"
  cat > "$CODEX_SKILL_DIR/SKILL.md" << 'SKILLEOF'
---
name: clauvis
description: Manage todos, ideas, work logs, and projects via Clauvis MCP tools
triggers:
  - "todo"
  - "idea"
  - "work log"
  - "remember"
---

# Clauvis Skill

Use the Clauvis MCP tools to manage todos, ideas, work logs, and projects.

## Available MCP Tools
- `list_todos` — List pending todos (filter by project with `project` param)
- `add_todo` — Add a new todo (title, project, deadline optional)
- `complete_todo` — Mark a todo as complete (by id)
- `delete_todo` — Delete a todo (by id)
- `add_idea` — Save an idea
- `list_ideas` — List saved ideas
- `add_work_log` — Save a work log entry (title, content, project)
- `list_work_logs` — List work logs
- `list_projects` — List all projects

## Behavior
- After completing a milestone (commit, feature, bug fix), ask: "Save a work log?" If yes, use add_work_log.
- If work relates to an existing todo, ask: "Mark as done in Clauvis?" If yes, use complete_todo.
- Infer project from current directory when possible.
SKILLEOF
  echo "✓ Clauvis skill installed"

  # Add instructions to AGENTS.md
  if [ -f "$CODEX_AGENTS_MD" ]; then
    if ! grep -q "## Clauvis" "$CODEX_AGENTS_MD"; then
      cat >> "$CODEX_AGENTS_MD" << 'AGENTSEOF'

---

## Clauvis
- Todos are auto-injected at session start. Summarize them for the user.
- After completing a milestone (commit, feature, bug fix), ask: "Save a work log?" If yes, use add_work_log MCP tool.
- If the work relates to an existing todo, ask: "Mark as done in Clauvis?" If yes, use complete_todo MCP tool.
AGENTSEOF
      echo "✓ AGENTS.md updated"
    else
      echo "✓ AGENTS.md already has Clauvis config"
    fi
  fi
fi


# ============================================================
# Register Projects
# ============================================================
echo ""
echo "✅ Basic setup complete!"
echo ""
echo "📁 Register projects to auto-filter todos by directory."
echo "   (Registers folders containing .git as projects)"
echo ""

register_project() {
  local dir="$1"
  local slug=$(basename "$dir")
  local parent=$(basename "$(dirname "$dir")")

  local exists=$(curl -s -H "Authorization: Bearer $API_KEY" "$CLAUVIS_URL/api/projects" 2>/dev/null | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    if p.get('directoryPath') == '$dir':
        print('yes')
        break
" 2>/dev/null)

  if [ "$exists" = "yes" ]; then
    echo "  · $slug (already registered)"
    return
  fi

  local status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$CLAUVIS_URL/api/projects" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"slug\":\"$slug\",\"directoryPath\":\"$dir\"}")

  if [ "$status" = "409" ]; then
    slug="${parent}-${slug}"
    curl -s -X POST "$CLAUVIS_URL/api/projects" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"slug\":\"$slug\",\"directoryPath\":\"$dir\"}" > /dev/null 2>&1
  fi

  echo "  ✓ $slug registered"
}

while true; do
  read -p "Enter project path (drag folder, or press Enter to finish): " PROJECT_INPUT < /dev/tty

  [ -z "$PROJECT_INPUT" ] && break

  PROJECT_DIR=$(realpath "$(eval echo "$PROJECT_INPUT")" 2>/dev/null || eval echo "$PROJECT_INPUT")

  if [ ! -d "$PROJECT_DIR" ]; then
    echo "  ❌ Directory not found: $PROJECT_DIR"
    continue
  fi

  GIT_COUNT=$(find "$PROJECT_DIR" -maxdepth 2 -name ".git" -type d 2>/dev/null | wc -l | tr -d ' ')
  if [ "$GIT_COUNT" = "0" ]; then
    echo "  ⚠ No .git projects found in: $PROJECT_DIR"
  else
    find "$PROJECT_DIR" -maxdepth 2 -name ".git" -type d 2>/dev/null | while read gitdir; do
      register_project "$(dirname "$gitdir")"
    done
  fi

  echo ""
done

echo ""
echo "✅ Clauvis setup complete!"
echo ""
echo "Installed for: $TOOLS"
echo "  ✓ MCP server (todos, ideas, work logs available in AI tools)"
echo "  ✓ Session hook (todos shown on first message)"
echo "  ✓ Clauvis skill (auto-triggers on todo/idea/work log expressions)"
echo ""
echo "Usage:"
echo "  1. Restart your AI tool (Claude Code / Codex)"
echo "  2. Send any message — your todos will appear automatically"
echo "  3. Run in a project directory to see only that project's todos"
echo "  4. After completing work, the AI will ask to save a work log"
echo ""
echo "Telegram bot: https://t.me/clauvis_ai_bot"
