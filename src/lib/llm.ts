import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { projects } from "./db/schema";

const anthropic = new Anthropic();

interface ParsedTodo {
  title: string;
  projectName: string | null;
  priority: "urgent" | "normal" | "low";
  deadline: string | null;
  memo: string | null;
}

export async function parseNaturalLanguage(
  input: string
): Promise<ParsedTodo> {
  const projectList = await db.select().from(projects);
  const projectContext = projectList
    .map((p) => `- ${p.name} (aliases: ${p.aliases.join(", ") || "없음"})`)
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `당신은 할일 파싱 도우미입니다. 사용자의 자연어 입력을 구조화된 할일로 변환해주세요.

오늘 날짜: ${today}

등록된 프로젝트:
${projectContext || "없음"}

사용자 입력: "${input}"

다음 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "title": "정리된 할일 제목",
  "projectName": "매칭되는 프로젝트명 또는 null",
  "priority": "urgent 또는 normal 또는 low",
  "deadline": "YYYY-MM-DD 형식 또는 null",
  "memo": "추가 맥락이 있으면 문자열, 없으면 null"
}

규칙:
- 오타와 줄임말을 보정하세요
- 프로젝트 alias와 매칭되면 해당 프로젝트명을 사용하세요
- "내일", "다음주" 같은 상대적 날짜를 절대 날짜로 변환하세요
- 마감이 임박하면 priority를 urgent로 설정하세요`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return JSON.parse(text);
}

export async function generateDailySummary(
  todos: Array<{ title: string; projectName: string | null; deadline: Date | null; priority: string }>
): Promise<string> {
  const todoList = todos
    .map(
      (t) =>
        `- ${t.title} (프로젝트: ${t.projectName || "미분류"}, 기한: ${t.deadline?.toISOString().split("T")[0] || "없음"}, 우선순위: ${t.priority})`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `당신은 개인 비서입니다. 아래 할일 목록을 보고 오늘의 요약을 텔레그램 메시지로 작성해주세요.

할일 목록:
${todoList}

규칙:
- 급한 것(마감 임박, urgent)을 먼저 언급
- 간결하고 친근한 톤
- 이모지 적절히 사용
- 마감일이 있으면 D-day 표시`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
