#!/bin/bash
# Clauvis session start hook
# Injects todo list on first message of each session

LOCK_FILE="/tmp/clauvis-session-$$"

# Only run once per session (parent PID = session)
PPID_LOCK="/tmp/clauvis-session-$PPID"
if [ -f "$PPID_LOCK" ]; then
  exit 0
fi
touch "$PPID_LOCK"

# Clean up on exit (session end)
trap "rm -f $PPID_LOCK" EXIT

# Read API key from settings.json
API_KEY=$(python3 -c "
import json, os
settings_path = os.path.expanduser('~/.claude/settings.json')
with open(settings_path) as f:
    s = json.load(f)
headers = s.get('mcpServers', {}).get('clauvis', {}).get('headers', {})
auth = headers.get('Authorization', '')
print(auth.replace('Bearer ', ''))
" 2>/dev/null)

if [ -z "$API_KEY" ]; then
  exit 0
fi

URL=$(python3 -c "
import json, os
with open(os.path.expanduser('~/.claude/settings.json')) as f:
    s = json.load(f)
url = s.get('mcpServers', {}).get('clauvis', {}).get('url', '')
print(url.replace('/mcp', ''))
" 2>/dev/null)

if [ -z "$URL" ]; then
  exit 0
fi

# Check for clauvis-project in local CLAUDE.md
PROJECT=""
for f in CLAUDE.md .claude/CLAUDE.md; do
  if [ -f "$f" ]; then
    P=$(grep -m1 "clauvis-project:" "$f" 2>/dev/null | sed 's/.*clauvis-project:\s*//')
    if [ -n "$P" ]; then
      PROJECT="$P"
      break
    fi
  fi
done

# Fetch todos
if [ -n "$PROJECT" ]; then
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$URL/api/todos?status=pending&project=$PROJECT" 2>/dev/null)
else
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$URL/api/todos?status=pending" 2>/dev/null)
fi

# Check if we got results
COUNT=$(echo "$TODOS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)

if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
  exit 0
fi

# Format output
echo "<clauvis-todos>"
if [ -n "$PROJECT" ]; then
  echo "프로젝트 '$PROJECT'의 할일 ${COUNT}개:"
else
  echo "전체 할일 ${COUNT}개:"
fi
echo "$TODOS" | python3 -c "
import sys, json
todos = json.load(sys.stdin)
grouped = {}
for t in todos:
    p = t.get('projectName') or '미분류'
    if p not in grouped:
        grouped[p] = []
    grouped[p].append(t)
i = 1
for proj, items in grouped.items():
    print(f'\n[{proj}]')
    for t in items:
        deadline = ''
        if t.get('deadline'):
            deadline = f\" (기한: {t['deadline'][:10]})\"
        print(f\"  {i}. {t['title']}{deadline}\")
        i += 1
" 2>/dev/null
echo ""
echo "위 할일 목록을 간단히 요약해서 사용자에게 알려주세요."
echo "</clauvis-todos>"
