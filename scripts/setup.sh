#!/bin/bash
# Clauvis Setup Script
# Usage: curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash

set -e

CLAUVIS_URL="${CLAUVIS_URL:-https://clauvis.backproach.dev}"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
HOOK_DIR="$CLAUDE_DIR/clauvis"
HOOK_FILE="$HOOK_DIR/hook.sh"

echo "🔧 Clauvis Setup"
echo ""
echo "If you don't have an API Key, get one from the Telegram bot:"
echo "  👉 https://t.me/clauvis_ai_bot → send /start"
echo ""

# 1. API Key input
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

# 2. Install hook script
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

# 3. Add MCP server
claude mcp remove clauvis --scope user 2>/dev/null || true
claude mcp add --transport http --scope user clauvis "$CLAUVIS_URL/api/mcp" \
  --header "Authorization: Bearer $API_KEY" 2>/dev/null
echo "✓ MCP server configured"

# 4. Add hook to settings.json
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

# 5. Install Clauvis skill
SKILL_DIR="$CLAUDE_DIR/skills/clauvis"
mkdir -p "$SKILL_DIR"
curl -sL "https://raw.githubusercontent.com/ukth/clauvis/main/scripts/clauvis-skill.md" > "$SKILL_DIR/SKILL.md"
echo "✓ Clauvis skill installed"

# 6. Add minimal instructions to CLAUDE.md
CLAUVIS_LINE="## Clauvis
- Todos are auto-injected at session start. Summarize them for the user."

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

echo ""
echo "✅ Basic setup complete!"

# 7. Register projects
echo ""
echo "📁 Register projects to auto-filter todos by directory in Claude Code."
echo "   (Registers folders containing .git as projects)"
echo ""

while true; do
  read -p "Enter project path (drag folder, or press Enter to finish): " PROJECT_INPUT < /dev/tty

  # Empty input = done
  [ -z "$PROJECT_INPUT" ] && break

  PROJECT_DIR=$(realpath "$(eval echo "$PROJECT_INPUT")" 2>/dev/null || eval echo "$PROJECT_INPUT")

  if [ ! -d "$PROJECT_DIR" ]; then
    echo "  ❌ Directory not found: $PROJECT_DIR"
    continue
  fi

  # Register project (retry with parent folder prefix on slug conflict)
  register_project() {
    local dir="$1"
    local slug=$(basename "$dir")
    local parent=$(basename "$(dirname "$dir")")

    # Skip if already registered with same path
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

    # Attempt registration
    local status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$CLAUVIS_URL/api/projects" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"slug\":\"$slug\",\"directoryPath\":\"$dir\"}")

    if [ "$status" = "409" ]; then
      # Slug conflict — retry with parent folder prefix
      slug="${parent}-${slug}"
      curl -s -X POST "$CLAUVIS_URL/api/projects" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"slug\":\"$slug\",\"directoryPath\":\"$dir\"}" > /dev/null 2>&1
    fi

    echo "  ✓ $slug registered"
  }

  # Find .git projects
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
echo "Installed:"
echo "  ✓ MCP server (todo tools available in Claude Code)"
echo "  ✓ Session hook (todos shown on first message)"
echo "  ✓ CLAUDE.md instructions (todo summary + completion prompts)"
echo ""
echo "Usage:"
echo "  1. Restart Claude Code"
echo "  2. Send any message — your todos will appear automatically"
echo "  3. Run in a project directory to see only that project's todos"
echo ""
echo "Telegram bot: https://t.me/clauvis_ai_bot"
