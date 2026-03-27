#!/bin/bash
# Clauvis Setup Script
# Usage: curl -s https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash

set -e

CLAUVIS_URL="https://app-azure-sigma-80.vercel.app"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
HOOK_DIR="$CLAUDE_DIR/clauvis"
HOOK_FILE="$HOOK_DIR/hook.sh"

echo "🔧 Clauvis Setup"
echo ""

# 1. API Key 입력
read -p "API Key를 입력하세요 (clv_...): " API_KEY

if [[ ! "$API_KEY" =~ ^clv_ ]]; then
  echo "❌ 유효하지 않은 API Key입니다. clv_로 시작해야 합니다."
  exit 1
fi

# API Key 검증
VERIFY=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $API_KEY" "$CLAUVIS_URL/api/projects")
if [ "$VERIFY" != "200" ]; then
  echo "❌ API Key 인증 실패. 텔레그램 봇에서 /start 로 발급받으세요."
  exit 1
fi

echo "✓ API Key 확인됨"

# 2. Hook 스크립트 설치
mkdir -p "$HOOK_DIR"

cat > "$HOOK_FILE" << 'HOOKSCRIPT'
#!/bin/bash
# Clauvis session start hook - shows todos on first message

PPID_LOCK="/tmp/clauvis-session-$PPID"
if [ -f "$PPID_LOCK" ]; then
  exit 0
fi
touch "$PPID_LOCK"

SETTINGS="$HOME/.claude/settings.json"
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

PROJECT=""
for f in CLAUDE.md .claude/CLAUDE.md; do
  if [ -f "$f" ]; then
    P=$(grep -m1 "clauvis-project:" "$f" 2>/dev/null | sed 's/.*clauvis-project:[[:space:]]*//')
    [ -n "$P" ] && PROJECT="$P" && break
  fi
done

if [ -n "$PROJECT" ]; then
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$URL/api/todos?status=pending&project=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PROJECT'))")" 2>/dev/null)
else
  TODOS=$(curl -s -H "Authorization: Bearer $API_KEY" "$URL/api/todos?status=pending" 2>/dev/null)
fi

COUNT=$(echo "$TODOS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ -z "$COUNT" ] || [ "$COUNT" = "0" ] && exit 0

echo "<clauvis-todos>"
[ -n "$PROJECT" ] && echo "프로젝트 '$PROJECT'의 할일 ${COUNT}개:" || echo "전체 할일 ${COUNT}개:"
echo "$TODOS" | python3 -c "
import sys, json
todos = json.load(sys.stdin)
grouped = {}
for t in todos:
    p = t.get('projectName') or '미분류'
    grouped.setdefault(p, []).append(t)
i = 1
for proj, items in grouped.items():
    print(f'\n[{proj}]')
    for t in items:
        d = f\" (기한: {t['deadline'][:10]})\" if t.get('deadline') else ''
        print(f'  {i}. {t[\"title\"]}{d}')
        i += 1
" 2>/dev/null
echo ""
echo "위 할일 목록을 간단히 요약해서 사용자에게 알려주세요."
echo "</clauvis-todos>"
HOOKSCRIPT

chmod +x "$HOOK_FILE"
echo "✓ Hook 스크립트 설치 완료"

# 3. settings.json에 MCP 서버 + Hook 추가
mkdir -p "$CLAUDE_DIR"

python3 -c "
import json, os

path = '$SETTINGS_FILE'
if os.path.exists(path):
    with open(path, 'r') as f:
        settings = json.load(f)
else:
    settings = {}

# MCP 서버
settings.setdefault('mcpServers', {})
settings['mcpServers']['clauvis'] = {
    'type': 'url',
    'url': '$CLAUVIS_URL/api/mcp',
    'headers': {
        'Authorization': 'Bearer $API_KEY'
    }
}

# Hook
settings.setdefault('hooks', {})
existing = settings['hooks'].get('UserPromptSubmit', [])
# Remove old clauvis hooks
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
print('✓ MCP 서버 + Hook 설정 완료')
"

# 4. CLAUDE.md에 Clauvis 지시 추가
CLAUVIS_BLOCK="## Clauvis (할일 관리)
- 세션 시작 시 할일 목록이 자동으로 주입됩니다 (hook). 요약해서 알려주세요.
- 프로젝트 CLAUDE.md에 \`clauvis-project: 프로젝트명\`이 있으면 해당 프로젝트만 표시됩니다.
- 작업 완료 시 사용자에게 Clauvis에서 완료 처리할지 물어볼 것
- MCP 도구: list_todos, add_todo, complete_todo, list_projects, add_project"

if [ -f "$CLAUDE_MD" ]; then
  if grep -q "Clauvis" "$CLAUDE_MD"; then
    # 기존 Clauvis 블록 교체
    python3 -c "
import re
with open('$CLAUDE_MD', 'r') as f:
    content = f.read()
new_block = '''$CLAUVIS_BLOCK'''
content = re.sub(r'## Clauvis.*?(?=\n## |\Z)', new_block + '\n', content, flags=re.DOTALL)
with open('$CLAUDE_MD', 'w') as f:
    f.write(content)
print('✓ CLAUDE.md Clauvis 설정 업데이트 완료')
"
  else
    echo "" >> "$CLAUDE_MD"
    echo "$CLAUVIS_BLOCK" >> "$CLAUDE_MD"
    echo "✓ CLAUDE.md에 Clauvis 지시 추가 완료"
  fi
else
  echo "$CLAUVIS_BLOCK" > "$CLAUDE_MD"
  echo "✓ CLAUDE.md 생성 완료"
fi

echo ""
echo "✅ Clauvis 설정 완료!"
echo ""
echo "설치된 항목:"
echo "  ✓ MCP 서버 (Claude Code에서 할일 도구 사용 가능)"
echo "  ✓ 세션 시작 Hook (첫 메시지 시 할일 자동 표시)"
echo "  ✓ CLAUDE.md 지시 (할일 요약 + 완료 처리 안내)"
echo ""
echo "사용법:"
echo "  1. Claude Code를 재시작하세요"
echo "  2. 아무 메시지나 보내면 할일이 자동으로 표시됩니다"
echo "  3. 프로젝트별 필터링: 프로젝트 CLAUDE.md에 아래 추가"
echo "     clauvis-project: 프로젝트명"
echo ""
echo "텔레그램 봇: @clauvis_bot"
