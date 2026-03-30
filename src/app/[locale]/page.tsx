import { notFound } from "next/navigation";
import { CopyButton } from "./copy-button";
import {
  ChatBubbleLeftRightIcon,
  FolderIcon,
  DevicePhoneMobileIcon,
  BoltIcon,
  LightBulbIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";

const dict = {
  en: {
    tagline: "Todo manager for developers",
    heroTitle1: "Your todos, where",
    heroTitle2: "you ",
    heroAccent: "actually",
    heroTitle3: " work.",
    heroDesc: "Capture tasks in Telegram. See them in Claude Code. Manage across projects with natural language. No context switching.",
    startBtn: "Start with Telegram",
    install: "Install",
    or: "or",
    howItWorks: "How it works",
    features: "Features",
    feat1: { title: "Natural language", desc: "Type like you think. AI parses project, priority, and deadline from plain text." },
    feat2: { title: "Project-aware", desc: "Todos are grouped by project. Open a directory, see only what matters." },
    feat3: { title: "Telegram bot", desc: "Add todos from your phone at 2am. Check them on your commute." },
    feat4: { title: "Claude Code MCP", desc: "Todos show up when you start coding. Complete them when you're done." },
    feat5: { title: "Context memory", desc: "The bot remembers your conversation. 'mark 2 as done' just works." },
    feat6: { title: "Bring your own key", desc: "Free command mode for everyone. Register your API key to unlock AI agent mode." },
    setup: "Get started",
    step1Title: "Get your API key",
    step1Desc: "on Telegram and send",
    step2Title: "Install Claude Code integration",
    step2Note: "Sets up MCP server, session hook, and skill.",
    step3Title: "Start working",
    step3Desc: "Open Claude Code in any project directory. Your todos are already there.",
    demoRight1: "fix image upload bug in my-app",
    demoLeft1: "[my-app] Fix image upload bug\nAdded!",
    demoRight2: "show my todos",
    demoLeft2: "[my-app]\n1. Fix image upload bug\n2. Add dark mode\n\n[backend]\n1. Optimize DB queries\n2. Add rate limiting",
    demoRight3: "my-app 1 done",
    demoLeft3: "Done: Fix image upload bug (3 remaining)",
    terminalStart: "Session started",
    terminalTodos: "2 todos:",
    terminalTodo1: "1. Add dark mode",
    terminalTodo2: "2. Fix responsive layout",
    terminalYou1: "let's work on #1",
    terminalWorking: "Working on Add dark mode...",
    terminalDone: "... task complete ...",
    terminalAsk: "Mark as done in Clauvis?",
    terminalYes: "yes",
    terminalChecked: "✓ Marked as done",
  },
  ko: {
    tagline: "개발자를 위한 할일 관리",
    heroTitle1: "할일을, 당신이",
    heroTitle2: "",
    heroAccent: "실제로",
    heroTitle3: " 일하는 곳에서.",
    heroDesc: "텔레그램에서 할일을 기록하고, Claude Code에서 바로 확인하세요. 자연어로 프로젝트를 넘나들며 관리. 컨텍스트 스위칭 없이.",
    startBtn: "텔레그램으로 시작",
    install: "설치",
    or: "또는",
    howItWorks: "이렇게 동작해요",
    features: "기능",
    feat1: { title: "자연어 입력", desc: "생각하는 대로 입력하세요. AI가 프로젝트, 우선순위, 기한을 자동으로 파싱합니다." },
    feat2: { title: "프로젝트별 관리", desc: "할일은 프로젝트별로 그룹화됩니다. 디렉토리를 열면 해당 프로젝트의 할일만 보여요." },
    feat3: { title: "텔레그램 봇", desc: "새벽 2시에 떠오른 할일을 폰으로 바로 추가. 출퇴근길에 확인하세요." },
    feat4: { title: "Claude Code MCP", desc: "코딩을 시작하면 할일이 자동으로 표시됩니다. 끝나면 바로 완료 처리." },
    feat5: { title: "대화 기억", desc: "봇이 대화 맥락을 기억합니다. '2번 완료'만 말하면 됩니다." },
    feat6: { title: "나만의 API 키", desc: "명령어 모드는 무료. API 키를 등록하면 AI 에이전트 모드가 활성화됩니다." },
    setup: "시작하기",
    step1Title: "API 키 발급",
    step1Desc: "텔레그램에서 아래 봇에게",
    step2Title: "Claude Code 연동 설치",
    step2Note: "MCP 서버, 세션 훅, 스킬이 설정됩니다.",
    step3Title: "시작하세요",
    step3Desc: "아무 프로젝트 디렉토리에서 Claude Code를 열면 할일이 이미 표시됩니다.",
    demoRight1: "my-app 이미지 업로드 버그 수정해줘",
    demoLeft1: "[my-app] 이미지 업로드 버그 수정\n추가했어요",
    demoRight2: "할일 보여줘",
    demoLeft2: "[my-app]\n1. 이미지 업로드 버그 수정\n2. 다크모드 추가\n\n[backend]\n1. DB 쿼리 최적화\n2. 속도 제한 추가",
    demoRight3: "my-app 1번 완료",
    demoLeft3: "완료: 이미지 업로드 버그 수정 (남은 할일 3개)",
    terminalStart: "세션 시작",
    terminalTodos: "할일 2개:",
    terminalTodo1: "1. 다크모드 추가",
    terminalTodo2: "2. 반응형 레이아웃 수정",
    terminalYou1: "1번 작업하자",
    terminalWorking: "다크모드 추가 작업 중...",
    terminalDone: "... 작업 완료 ...",
    terminalAsk: "Clauvis에서 완료 처리할까요?",
    terminalYes: "ㅇㅇ",
    terminalChecked: "✓ 완료 처리됨",
  },
} as const;

type Locale = keyof typeof dict;

const SETUP_CMD = "curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "ko" }];
}

export default async function LocalePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!dict[locale as Locale]) notFound();
  const t = dict[locale as Locale];
  const otherLocale = locale === "ko" ? "en" : "ko";

  return (
    <main className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono text-sm tracking-wider text-accent">
              <img src="/mascot.svg" alt="" className="w-6 h-6" />
              Clauvis
            </span>
          <div className="flex items-center gap-6">
            <a href="#install" className="text-sm text-muted hover:text-foreground transition-colors">{t.install}</a>
            <a href={`/${otherLocale}`} className="text-sm text-muted hover:text-foreground transition-colors font-mono">
              {otherLocale.toUpperCase()}
            </a>
            <a href="https://t.me/clauvis_ai_bot" target="_blank" className="text-sm text-muted hover:text-foreground transition-colors">Telegram</a>
            <a href="https://github.com/ukth/clauvis" target="_blank" className="text-sm text-muted hover:text-foreground transition-colors">GitHub</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-36 pb-32 px-6 overflow-hidden grid-bg">
        <div className="hero-glow" />
        <div className="max-w-6xl mx-auto text-center relative z-10">
          <div className="animate-fade-up">
            <p className="font-mono text-xs text-accent mb-8 tracking-widest uppercase">{t.tagline}</p>
            <h1 className="text-3xl sm:text-5xl md:text-7xl font-light leading-[1.08] tracking-tight mx-auto max-w-4xl">
              {t.heroTitle1}
              <br />
              {t.heroTitle2}<span className="text-accent font-normal">{t.heroAccent}</span>{t.heroTitle3}
            </h1>
          </div>
          <p className="animate-fade-up-delay-1 mt-8 text-sm sm:text-lg text-muted max-w-2xl mx-auto leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="animate-fade-up-delay-2 mt-12 flex flex-col sm:flex-row gap-4 items-center justify-center">
            <a
              href="https://t.me/clauvis_ai_bot"
              target="_blank"
              className="px-6 py-3 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-dim transition-colors"
            >
              {t.startBtn}
            </a>
            <span className="text-muted text-sm">{t.or}</span>
            <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center gap-3 max-w-full overflow-hidden">
              <span className="text-muted font-mono text-sm">$</span>
              <code className="text-xs sm:text-sm font-mono text-foreground select-all break-all flex-1">
                {SETUP_CMD}
              </code>
              <CopyButton text={SETUP_CMD} />
            </div>
          </div>
          <p className="animate-fade-up-delay-3 mt-6 font-mono text-xs text-muted">
            Open Source &middot; MIT License
          </p>
        </div>
      </section>

      {/* Demo */}
      <section className="py-28 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <p className="font-mono text-xs text-accent mb-4 tracking-widest uppercase">{t.howItWorks}</p>
          <h2 className="text-2xl sm:text-3xl font-light mb-12 max-w-lg">Telegram + Claude Code,<br />seamlessly connected.</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Telegram mockup */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden card-glow transition-all duration-300">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <img src="/mascot.svg" alt="" className="w-5 h-5 rounded-full" />
                <span className="text-xs text-muted font-mono">Clauvis Bot</span>
              </div>
              <div className="p-5 space-y-3 font-mono text-sm">
                <Bubble side="right" text={t.demoRight1} />
                <Bubble side="left" text={t.demoLeft1} />
                <Bubble side="right" text={t.demoRight2} />
                <Bubble side="left" text={t.demoLeft2} />
                <Bubble side="right" text={t.demoRight3} />
                <Bubble side="left" text={t.demoLeft3} />
              </div>
            </div>

            {/* Terminal mockup */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden card-glow transition-all duration-300">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="text-xs text-muted font-mono ml-2">~/my-app</span>
              </div>
              <div className="p-5 font-mono text-sm space-y-2">
                <div className="text-muted">$ claude</div>
                <div className="text-muted text-xs mt-1">&gt; {t.terminalStart}</div>
                <div className="mt-3 border-l-2 border-accent pl-3 py-1.5">
                  <div className="text-accent text-xs mb-1.5">Clauvis &middot; my-app</div>
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
      <section className="py-28 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <p className="font-mono text-xs text-accent mb-4 tracking-widest uppercase">{t.features}</p>
          <h2 className="text-2xl sm:text-3xl font-light mb-14 max-w-lg">Everything you need,<br />nothing you don&apos;t.</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: ChatBubbleLeftRightIcon, ...t.feat1 },
              { icon: FolderIcon, ...t.feat2 },
              { icon: DevicePhoneMobileIcon, ...t.feat3 },
              { icon: BoltIcon, ...t.feat4 },
              { icon: LightBulbIcon, ...t.feat5 },
              { icon: KeyIcon, ...t.feat6 },
            ].map((feat, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-6 card-glow transition-all duration-300">
                <feat.icon className="w-7 h-7 mb-4 text-accent" />
                <h3 className="text-sm font-medium mb-2">{feat.title}</h3>
                <p className="text-xs text-muted leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Setup */}
      <section id="install" className="py-28 px-6 border-t border-border relative grid-bg">
        <div className="hero-glow" style={{ top: "0%" }} />
        <div className="max-w-6xl mx-auto relative z-10">
          <p className="font-mono text-xs text-accent mb-4 tracking-widest uppercase">{t.setup}</p>
          <h2 className="text-2xl sm:text-3xl font-light mb-14 max-w-lg">Up and running<br />in 2 minutes.</h2>
          <div className="space-y-8 max-w-2xl">
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
              <div className="bg-surface rounded-lg border border-border p-4 font-mono text-xs sm:text-sm overflow-x-auto flex items-center gap-3">
                <span className="text-muted">$</span>
                <span className="text-foreground select-all break-all flex-1">
                  {SETUP_CMD}
                </span>
                <CopyButton text={SETUP_CMD} />
              </div>
              <p className="text-muted text-xs mt-3">{t.step2Note}</p>
              <p className="text-muted text-xs mt-2">
                {locale === "ko"
                  ? "Windows: WSL 터미널에서 실행하세요."
                  : "Windows: Run inside a WSL terminal."}
              </p>
            </Step>
            <Step n="3" title={t.step3Title}>
              <p className="text-muted text-sm">{t.step3Desc}</p>
            </Step>
          </div>
        </div>
      </section>

      {/* Self-hosting */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <p className="font-mono text-xs text-accent mb-2 tracking-widest uppercase">Self-hosting</p>
            <p className="text-sm text-muted max-w-md">
              {locale === "ko"
                ? "데이터를 직접 관리하고 싶다면, Clauvis를 자체 서버에 배포하세요. 오픈소스이며 Vercel + Neon 무료 티어로 운영 비용 $0."
                : "Want full control over your data? Deploy Clauvis on your own infrastructure. Open source, runs free on Vercel + Neon."}
            </p>
          </div>
          <a
            href="https://github.com/ukth/clauvis#self-hosting"
            target="_blank"
            className="px-5 py-2.5 border border-accent/40 text-accent text-sm font-medium rounded-lg hover:bg-accent/10 transition-colors whitespace-nowrap"
          >
            {locale === "ko" ? "가이드 보기" : "View Guide"} →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 font-mono text-sm text-accent">
              <img src="/mascot.svg" alt="" className="w-5 h-5" />
              Clauvis
            </span>
            <span className="text-xs text-muted font-mono">Open Source &middot; MIT License</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted">
            <a href="https://github.com/ukth/clauvis#self-hosting" target="_blank" className="hover:text-foreground transition-colors">Self-hosting</a>
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
    <div className={`flex ${side === "right" ? "justify-end" : "justify-start"} items-end gap-2`}>
      {side === "left" && (
        <img src="/mascot.svg" alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
      )}
      <div
        className={`max-w-[80%] px-3 py-2 rounded-lg whitespace-pre-line text-xs leading-relaxed ${
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

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-6">
      <div className="flex flex-col items-center">
        <div className="flex-shrink-0 w-10 h-10 rounded-full border border-accent/60 bg-accent/5 flex items-center justify-center">
          <span className="font-mono text-sm text-accent">{n}</span>
        </div>
        <div className="flex-1 w-px bg-border mt-2" />
      </div>
      <div className="pb-8">
        <h3 className="text-base font-medium mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
