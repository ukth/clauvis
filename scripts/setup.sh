#!/bin/bash
# Clauvis Setup Script
# Usage: curl -s https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash

set -e

CLAUVIS_URL="https://app-azure-sigma-80.vercel.app"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"

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

# 2. settings.json에 MCP 서버 추가
mkdir -p "$CLAUDE_DIR"

if [ -f "$SETTINGS_FILE" ]; then
  # 기존 파일에 clauvis MCP 추가
  if command -v python3 &> /dev/null; then
    python3 -c "
import json, sys

with open('$SETTINGS_FILE', 'r') as f:
    settings = json.load(f)

if 'mcpServers' not in settings:
    settings['mcpServers'] = {}

settings['mcpServers']['clauvis'] = {
    'type': 'url',
    'url': '$CLAUVIS_URL/api/mcp',
    'headers': {
        'Authorization': 'Bearer $API_KEY'
    }
}

with open('$SETTINGS_FILE', 'w') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
print('✓ MCP 서버 설정 완료')
"
  else
    echo "⚠ python3이 없어서 settings.json을 수동으로 수정해야 합니다."
    echo "  $SETTINGS_FILE 에 아래 내용을 추가하세요:"
    echo ""
    echo '  "mcpServers": {'
    echo '    "clauvis": {'
    echo '      "type": "url",'
    echo "      \"url\": \"$CLAUVIS_URL/api/mcp\","
    echo '      "headers": {'
    echo "        \"Authorization\": \"Bearer $API_KEY\""
    echo '      }'
    echo '    }'
    echo '  }'
  fi
else
  cat > "$SETTINGS_FILE" << SETTINGS
{
  "mcpServers": {
    "clauvis": {
      "type": "url",
      "url": "$CLAUVIS_URL/api/mcp",
      "headers": {
        "Authorization": "Bearer $API_KEY"
      }
    }
  }
}
SETTINGS
  echo "✓ MCP 서버 설정 완료"
fi

# 3. CLAUDE.md에 Clauvis 지시 추가
CLAUVIS_BLOCK="## Clauvis (할일 관리)
- 세션 시작 시 \`list_todos\` MCP 도구로 현재 프로젝트의 할일을 조회하고 요약해서 알려줄 것
- 프로젝트 CLAUDE.md에 \`clauvis-project: 프로젝트명\`이 있으면 해당 프로젝트로 필터링
- 없으면 전체 할일 조회
- 작업 완료 시 사용자에게 Clauvis에서 완료 처리할지 물어볼 것"

if [ -f "$CLAUDE_MD" ]; then
  if grep -q "Clauvis" "$CLAUDE_MD"; then
    echo "✓ CLAUDE.md에 이미 Clauvis 설정이 있습니다."
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
echo "사용법:"
echo "  1. Claude Code를 재시작하세요"
echo "  2. 세션 시작 시 자동으로 할일을 보여줍니다"
echo "  3. 프로젝트별 필터링: 프로젝트 CLAUDE.md에 아래 추가"
echo "     clauvis-project: 프로젝트명"
echo ""
echo "텔레그램 봇도 사용하세요: @clauvis_bot"
