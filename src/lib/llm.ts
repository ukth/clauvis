import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { projects } from "./db/schema";

const anthropic = new Anthropic();

function extractJson(raw: string): string {
  return raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
}

interface ParsedTodo {
  title: string;
  projectName: string | null;
  priority: "urgent" | "normal" | "low";
  deadline: string | null;
  memo: string | null;
}

interface AnalyzedIntent {
  intent: "add_todo" | "list" | "complete" | "question" | "chat" | "edit";
  todo?: ParsedTodo;
  completeTarget?: string;
  listFilter?: string;
  reply?: string;
}

export async function analyzeMessage(input: string): Promise<AnalyzedIntent> {
  const projectList = await db.select().from(projects);
  const projectContext = projectList
    .map((p) => `- ${p.name} (aliases: ${p.aliases.join(", ") || "없음"})`)
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `당신은 할일 관리 비서입니다. 사용자의 메시지를 분석해서 의도를 파악하세요.

오늘 날짜: ${today}

등록된 프로젝트:
${projectContext || "없음"}

사용자 메시지: "${input}"

의도를 분류하고 JSON으로만 응답하세요 (다른 텍스트 없이):

1. 할일 추가 (새로운 작업/태스크를 기록하려는 의도):
{"intent":"add_todo","todo":{"title":"정리된 제목","projectName":"프로젝트명 또는 null","priority":"urgent|normal|low","deadline":"YYYY-MM-DD 또는 null","memo":"부가 설명 또는 null"}}

2. 목록 조회 (할일을 보고 싶은 의도):
{"intent":"list","listFilter":"프로젝트명 또는 null"}

3. 완료 처리 ("N번 완료", "그거 됐어" 등):
{"intent":"complete","completeTarget":"번호 또는 할일 설명"}

4. 질문 (할일에 대해 물어보는 것):
{"intent":"question","reply":"질문에 대한 답변"}

5. 일상 대화/인사/의미없는 입력:
{"intent":"chat","reply":"적절한 응답"}

6. 할일 수정 (기존 할일 변경):
{"intent":"edit","reply":"어떻게 수정할지 안내"}

규칙:
- 명확한 작업/태스크가 있을 때만 add_todo로 분류
- 인사, 감탄사, 질문은 add_todo가 아님
- 오타와 줄임말을 보정
- 프로젝트 alias 매칭
- 상대적 날짜를 절대 날짜로 변환
- chat의 reply는 친근하고 간결하게`,
      },
    ],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text : "";
  return JSON.parse(extractJson(raw));
}

export async function parseNaturalLanguage(
  input: string
): Promise<ParsedTodo> {
  const result = await analyzeMessage(input);
  if (result.intent === "add_todo" && result.todo) {
    return result.todo;
  }
  return {
    title: input,
    projectName: null,
    priority: "normal",
    deadline: null,
    memo: null,
  };
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
