#!/bin/bash
# Clauvis Setup Script
# Usage: bash <(curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh)

set -e

CLAUVIS_URL="https://clauvis.vercel.app"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
HOOK_DIR="$CLAUDE_DIR/clauvis"
HOOK_FILE="$HOOK_DIR/hook.sh"

echo "🔧 Clauvis Setup"
echo ""
echo "API Key가 없다면 텔레그램 봇에서 발급받으세요:"
echo "  👉 https://t.me/ukth_clauvis_bot 에서 /start"
echo ""

# 1. API Key 입력
read -p "API Key를 입력하세요 (clv_...): " API_KEY < /dev/tty

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

# 1. .clauvis/config.md에서 프로젝트명 확인
PROJECT=""
if [ -f ".clauvis/config.md" ]; then
  PROJECT=$(grep -m1 "clauvis-project:" .clauvis/config.md 2>/dev/null | sed 's/.*clauvis-project:[[:space:]]*//')
fi

# 2. 없으면 현재 디렉토리로 프로젝트 자동 매칭
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
[ -n "$PROJECT" ] && echo "프로젝트 '$PROJECT'의 할일 ${COUNT}개:" || echo "전체 할일 ${COUNT}개:"
echo "$TODOS" | python3 -c "
import sys, json
todos = json.load(sys.stdin)
grouped = {}
for t in todos:
    p = t.get('projectName') or t.get('projectSlug') or '미분류'
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

# 3. MCP 서버 추가 (claude mcp add CLI 사용)
claude mcp add --transport http clauvis "$CLAUVIS_URL/api/mcp" \
  --header "Authorization: Bearer $API_KEY" 2>/dev/null
echo "✓ MCP 서버 설정 완료"

# 4. Hook 추가 (settings.json)
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
print('✓ Hook 설정 완료')
"

# 4. Clauvis 스킬 설치
SKILL_DIR="$CLAUDE_DIR/skills/clauvis"
mkdir -p "$SKILL_DIR"
curl -sL "https://raw.githubusercontent.com/ukth/clauvis/main/scripts/clauvis-skill.md" > "$SKILL_DIR/SKILL.md"
echo "✓ Clauvis 스킬 설치 완료"

# 5. CLAUDE.md에 최소 안내 추가
CLAUVIS_LINE="## Clauvis
- 세션 시작 시 할일이 자동 주입됩니다. 요약해서 알려주세요."

if [ -f "$CLAUDE_MD" ]; then
  if ! grep -q "Clauvis" "$CLAUDE_MD"; then
    echo "" >> "$CLAUDE_MD"
    echo "$CLAUVIS_LINE" >> "$CLAUDE_MD"
    echo "✓ CLAUDE.md 업데이트 완료"
  else
    echo "✓ CLAUDE.md에 이미 Clauvis 설정이 있습니다."
  fi
else
  echo "$CLAUVIS_LINE" > "$CLAUDE_MD"
  echo "✓ CLAUDE.md 생성 완료"
fi

echo ""
echo "✅ 기본 설정 완료!"

# 5. 프로젝트 등록 (반복)
echo ""
echo "📁 프로젝트를 등록하면 해당 디렉토리에서 Claude Code 실행 시 할일이 자동 필터링됩니다."
echo "   (.git이 있는 폴더를 프로젝트로 등록합니다)"
echo ""

while true; do
  read -p "프로젝트 경로를 입력하세요 (폴더 드래그 가능, 완료하려면 엔터): " PROJECT_INPUT < /dev/tty

  # 빈 입력이면 종료
  [ -z "$PROJECT_INPUT" ] && break

  PROJECT_DIR=$(realpath "$(eval echo "$PROJECT_INPUT")" 2>/dev/null || eval echo "$PROJECT_INPUT")

  if [ ! -d "$PROJECT_DIR" ]; then
    echo "  ❌ 디렉토리를 찾을 수 없습니다: $PROJECT_DIR"
    continue
  fi

  # 프로젝트 등록 함수 (slug 중복 시 상위 폴더 붙여 재시도)
  register_project() {
    local dir="$1"
    local slug=$(basename "$dir")
    local parent=$(basename "$(dirname "$dir")")

    # 이미 같은 경로로 등록되어 있으면 스킵
    local exists=$(curl -s -H "Authorization: Bearer $API_KEY" "$CLAUVIS_URL/api/projects" 2>/dev/null | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    if p.get('directoryPath') == '$dir':
        print('yes')
        break
" 2>/dev/null)

    if [ "$exists" = "yes" ]; then
      echo "  · $slug (이미 등록됨)"
      return
    fi

    # 등록 시도
    local status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$CLAUVIS_URL/api/projects" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"slug\":\"$slug\",\"aliases\":[],\"directoryPath\":\"$dir\"}")

    if [ "$status" = "409" ]; then
      # slug 중복 → 상위 폴더 붙여서 재시도
      slug="${parent}-${slug}"
      curl -s -X POST "$CLAUVIS_URL/api/projects" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"slug\":\"$slug\",\"aliases\":[],\"directoryPath\":\"$dir\"}" > /dev/null 2>&1
    fi

    echo "  ✓ $slug 등록 완료"
  }

  # .git이 있는 프로젝트 찾기
  find "$PROJECT_DIR" -maxdepth 2 -name ".git" -type d 2>/dev/null | while read gitdir; do
    register_project "$(dirname "$gitdir")"
  done

  echo ""
done

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
echo "  3. 각 프로젝트에서 실행하면 해당 프로젝트 할일만 표시됩니다"
echo ""
echo "텔레그램 봇: https://t.me/ukth_clauvis_bot"
