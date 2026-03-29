import { notFound } from "next/navigation";

const dict = {
  en: {
    tagline: "Todo manager for developers",
    heroTitle1: "Your todos, where",
    heroTitle2: "you ",
    heroAccent: "actually",
    heroTitle3: " work.",
    heroDesc: "Capture tasks in Telegram. See them in Claude Code. Manage across projects with natural language. No context switching.",
    startBtn: "Start with Telegram",
    or: "or",
    howItWorks: "How it works",
    features: "Features",
    feat1Title: "Natural language",
    feat1Desc: "Type like you think. AI parses project, priority, and deadline from plain text.",
    feat2Title: "Project-aware",
    feat2Desc: "Todos are grouped by project. Open a directory, see only what matters.",
    feat3Title: "Telegram bot",
    feat3Desc: "Add todos from your phone at 2am. Check them on your commute.",
    feat4Title: "Claude Code MCP",
    feat4Desc: "Todos show up when you start coding. Complete them when you're done.",
    feat5Title: "Context memory",
    feat5Desc: "The bot remembers your conversation. 'mark 2 as done' just works.",
    feat6Title: "Multi-user",
    feat6Desc: "Each user gets their own API key and isolated data.",
    setup: "Setup in 2 minutes",
    step1Title: "Get your API key",
    step1Desc: "on Telegram and send",
    step2Title: "Install Claude Code integration",
    step2Note: "Sets up MCP server, session hook, and skill.",
    step3Title: "Start working",
    step3Desc: "Open Claude Code in any project directory. Your todos are already there.",
    demoRight1: "fix image upload bug in mosun",
    demoLeft1: "[mosun-monorepo] 이미지 업로드 버그 수정\n추가했어요",
    demoRight2: "show my todos",
    demoLeft2: "[mosun-monorepo]\n1. 이미지 업로드 버그 수정\n2. 모바일 차단 유저 목록\n\n[team-maker]\n1. 세션 불러오기 오류\n2. 배포 버튼화",
    demoRight3: "mosun 1 done",
    demoLeft3: "완료: 이미지 업로드 버그 수정 (남은 할일 3개)",
    terminalStart: "Session started",
    terminalTodos: "할일 2개:",
    terminalTodo1: "1. 모바일 차단 유저 목록",
    terminalTodo2: "2. 온보딩 플로우 개선",
    terminalYou1: "1번 작업하자",
    terminalWorking: "Working on 모바일 차단 유저 목록...",
    terminalDone: "... 작업 완료 ...",
    terminalAsk: "Clauvis에서 완료 처리할까요?",
    terminalYes: "ㅇㅇ",
    terminalChecked: "✓ 완료 처리됨",
  },
  ko: {
    tagline: "개발자를 위한 할일 관리",
    heroTitle1: "할일을, 당신이",
    heroTitle2: "",
    heroAccent: "실제로",
    heroTitle3: " 일하는 곳에서.",
    heroDesc: "텔레그램에서 할일을 기록하고, Claude Code에서 바로 확인하세요. 자연어로 프로젝트를 넘나들며 관리. 컨텍스트 스위칭 없이.",
    startBtn: "텔레그램으로 시작",
    or: "또는",
    howItWorks: "이렇게 동작해요",
    features: "기능",
    feat1Title: "자연어 입력",
    feat1Desc: "생각하는 대로 입력하세요. AI가 프로젝트, 우선순위, 기한을 자동으로 파싱합니다.",
    feat2Title: "프로젝트별 관리",
    feat2Desc: "할일은 프로젝트별로 그룹화됩니다. 디렉토리를 열면 해당 프로젝트의 할일만 보여요.",
    feat3Title: "텔레그램 봇",
    feat3Desc: "새벽 2시에 떠오른 할일을 폰으로 바로 추가. 출퇴근길에 확인하세요.",
    feat4Title: "Claude Code MCP",
    feat4Desc: "코딩을 시작하면 할일이 자동으로 표시됩니다. 끝나면 바로 완료 처리.",
    feat5Title: "대화 기억",
    feat5Desc: "봇이 대화 맥락을 기억합니다. '2번 완료'만 말하면 됩니다.",
    feat6Title: "멀티 유저",
    feat6Desc: "각 사용자마다 고유한 API 키와 격리된 데이터를 제공합니다.",
    setup: "2분이면 설정 완료",
    step1Title: "API 키 발급",
    step1Desc: "텔레그램에서 아래 봇에게",
    step2Title: "Claude Code 연동 설치",
    step2Note: "MCP 서버, 세션 훅, 스킬이 설정됩니다.",
    step3Title: "시작하세요",
    step3Desc: "아무 프로젝트 디렉토리에서 Claude Code를 열면 할일이 이미 표시됩니다.",
    demoRight1: "mosun 이미지 업로드 버그 수정해줘",
    demoLeft1: "[mosun-monorepo] 이미지 업로드 버그 수정\n추가했어요",
    demoRight2: "할일 보여줘",
    demoLeft2: "[mosun-monorepo]\n1. 이미지 업로드 버그 수정\n2. 모바일 차단 유저 목록\n\n[team-maker]\n1. 세션 불러오기 오류\n2. 배포 버튼화",
    demoRight3: "mosun 1번 완료",
    demoLeft3: "완료: 이미지 업로드 버그 수정 (남은 할일 3개)",
    terminalStart: "세션 시작",
    terminalTodos: "할일 2개:",
    terminalTodo1: "1. 모바일 차단 유저 목록",
    terminalTodo2: "2. 온보딩 플로우 개선",
    terminalYou1: "1번 작업하자",
    terminalWorking: "모바일 차단 유저 목록 작업 중...",
    terminalDone: "... 작업 완료 ...",
    terminalAsk: "Clauvis에서 완료 처리할까요?",
    terminalYes: "ㅇㅇ",
    terminalChecked: "✓ 완료 처리됨",
  },
} as const;

type Locale = keyof typeof dict;

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "ko" }];
}

export default async function LocalePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!dict[locale as Locale]) notFound();
  const t = dict[locale as Locale];
  const otherLocale = locale === "ko" ? "en" : "ko";

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-mono text-sm tracking-wider text-accent">clauvis</span>
          <div className="flex items-center gap-6">
            <a href={`/${otherLocale}`} className="text-sm text-muted hover:text-foreground transition-colors font-mono">
              {otherLocale.toUpperCase()}
            </a>
            <a href="https://t.me/clauvis_ai_bot" target="_blank" className="text-sm text-muted hover:text-foreground transition-colors">Telegram</a>
            <a href="https://github.com/ukth/clauvis" target="_blank" className="text-sm text-muted hover:text-foreground transition-colors">GitHub</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="animate-fade-up">
            <p className="font-mono text-xs text-accent mb-6 tracking-widest uppercase">{t.tagline}</p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-light leading-[1.1] tracking-tight max-w-3xl">
              {t.heroTitle1}
              <br />
              {t.heroTitle2}<span className="text-accent font-normal">{t.heroAccent}</span>{t.heroTitle3}
            </h1>
          </div>
          <p className="animate-fade-up-delay-1 mt-8 text-lg text-muted max-w-xl leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="animate-fade-up-delay-2 mt-10 flex flex-wrap gap-4 items-center">
            <a
              href="https://t.me/clauvis_ai_bot"
              target="_blank"
              className="px-5 py-2.5 bg-accent text-background text-sm font-medium rounded hover:bg-accent-dim transition-colors"
            >
              {t.startBtn}
            </a>
            <span className="text-muted text-sm">{t.or}</span>
            <code className="text-sm font-mono text-muted bg-surface px-3 py-2 rounded border border-border select-all cursor-pointer hover:border-accent/40 transition-colors">
              curl -sL raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash
            </code>
          </div>
        </div>
      </section>

      {/* Demo */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-xs text-accent mb-10 tracking-widest uppercase">{t.howItWorks}</p>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Telegram mockup */}
            <div className="bg-surface rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-xs text-muted font-mono">Telegram</span>
              </div>
              <div className="p-4 space-y-3 font-mono text-sm">
                <Bubble side="right" text={t.demoRight1} />
                <Bubble side="left" text={t.demoLeft1} />
                <Bubble side="right" text={t.demoRight2} />
                <Bubble side="left" text={t.demoLeft2} />
                <Bubble side="right" text={t.demoRight3} />
                <Bubble side="left" text={t.demoLeft3} />
              </div>
            </div>

            {/* Terminal mockup */}
            <div className="bg-surface rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="text-xs text-muted font-mono ml-2">~/mosun-monorepo</span>
              </div>
              <div className="p-4 font-mono text-sm space-y-2">
                <div className="text-muted">$ claude</div>
                <div className="text-muted text-xs mt-1">&gt; {t.terminalStart}</div>
                <div className="mt-3 border-l-2 border-accent pl-3 py-1.5">
                  <div className="text-accent text-xs mb-1.5">Clauvis &middot; mosun-monorepo</div>
                  <div className="text-foreground text-xs">{t.terminalTodos}</div>
                  <div className="text-muted text-xs mt-1">{t.terminalTodo1}</div>
                  <div className="text-muted text-xs">{t.terminalTodo2}</div>
                </div>
                <div className="mt-4 text-xs">
                  <span className="text-accent">you:</span>{" "}
                  <span className="text-foreground">{t.terminalYou1}</span>
                </div>
                <div className="text-xs text-muted">{t.terminalWorking}</div>
                <div className="mt-4 text-xs text-muted opacity-50">{t.terminalDone}</div>
                <div className="mt-4 text-xs">
                  <span className="text-accent">claude:</span>{" "}
                  <span>{t.terminalAsk}</span>
                </div>
                <div className="text-xs">
                  <span className="text-accent">you:</span>{" "}
                  <span>{t.terminalYes}</span>
                </div>
                <div className="text-xs text-green-500">{t.terminalChecked}</div>
                <div className="text-muted text-xs mt-2">
                  <span className="animate-blink">&#9608;</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-xs text-accent mb-10 tracking-widest uppercase">{t.features}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden">
            <Card title={t.feat1Title} desc={t.feat1Desc} />
            <Card title={t.feat2Title} desc={t.feat2Desc} />
            <Card title={t.feat3Title} desc={t.feat3Desc} />
            <Card title={t.feat4Title} desc={t.feat4Desc} />
            <Card title={t.feat5Title} desc={t.feat5Desc} />
            <Card title={t.feat6Title} desc={t.feat6Desc} />
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-xs text-accent mb-10 tracking-widest uppercase">{t.setup}</p>
          <div className="space-y-10">
            <Step n="1" title={t.step1Title}>
              <p className="text-muted text-sm">
                {locale === "ko" ? (
                  <>
                    {t.step1Desc}{" "}
                    <code className="text-foreground bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono">/start</code>
                    {" "}를 보내세요 →{" "}
                    <a href="https://t.me/clauvis_ai_bot" target="_blank" className="text-accent hover:underline">
                      @clauvis_ai_bot
                    </a>
                  </>
                ) : (
                  <>
                    Message{" "}
                    <a href="https://t.me/clauvis_ai_bot" target="_blank" className="text-accent hover:underline">
                      @clauvis_ai_bot
                    </a>{" "}
                    {t.step1Desc}{" "}
                    <code className="text-foreground bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono">/start</code>
                  </>
                )}
              </p>
            </Step>
            <Step n="2" title={t.step2Title}>
              <div className="bg-surface rounded border border-border p-4 font-mono text-sm group">
                <span className="text-muted">$ </span>
                <span className="text-foreground select-all">
                  curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash
                </span>
              </div>
              <p className="text-muted text-xs mt-3">{t.step2Note}</p>
            </Step>
            <Step n="3" title={t.step3Title}>
              <p className="text-muted text-sm">{t.step3Desc}</p>
            </Step>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-mono text-xs text-muted">clauvis</span>
          <div className="flex items-center gap-6 text-xs text-muted">
            <a href="https://t.me/clauvis_ai_bot" target="_blank" className="hover:text-foreground transition-colors">Telegram</a>
            <a href="https://github.com/ukth/clauvis" target="_blank" className="hover:text-foreground transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Bubble({ side, text }: { side: "left" | "right"; text: string }) {
  return (
    <div className={`flex ${side === "right" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-lg whitespace-pre-line text-xs leading-relaxed ${
          side === "right"
            ? "bg-accent/12 text-foreground rounded-br-sm"
            : "bg-surface-2 text-foreground rounded-bl-sm"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function Card({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-surface p-6 hover:bg-surface-2 transition-colors">
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      <p className="text-xs text-muted leading-relaxed">{desc}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-5">
      <div className="flex-shrink-0 w-7 h-7 rounded-full border border-accent/60 flex items-center justify-center mt-0.5">
        <span className="font-mono text-xs text-accent">{n}</span>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2">{title}</h3>
        {children}
      </div>
    </div>
  );
}
