export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-mono text-sm tracking-wider text-accent">clauvis</span>
          <div className="flex items-center gap-6">
            <a href="https://t.me/ukth_clauvis_bot" target="_blank" className="text-sm text-muted hover:text-foreground transition-colors">Telegram</a>
            <a href="https://github.com/ukth/clauvis" target="_blank" className="text-sm text-muted hover:text-foreground transition-colors">GitHub</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="animate-fade-up">
            <p className="font-mono text-xs text-accent mb-6 tracking-widest uppercase">Todo manager for developers</p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-light leading-[1.1] tracking-tight max-w-3xl">
              Your todos, where
              <br />
              you <span className="text-accent font-normal">actually</span> work.
            </h1>
          </div>
          <p className="animate-fade-up-delay-1 mt-8 text-lg text-muted max-w-xl leading-relaxed">
            Capture tasks in Telegram. See them in Claude Code. Manage across projects with natural language. No context switching.
          </p>
          <div className="animate-fade-up-delay-2 mt-10 flex flex-wrap gap-4 items-center">
            <a
              href="https://t.me/ukth_clauvis_bot"
              target="_blank"
              className="px-5 py-2.5 bg-accent text-background text-sm font-medium rounded hover:bg-accent-dim transition-colors"
            >
              Start with Telegram
            </a>
            <span className="text-muted text-sm">or</span>
            <code className="text-sm font-mono text-muted bg-surface px-3 py-2 rounded border border-border select-all cursor-pointer hover:border-accent/40 transition-colors">
              curl -sL raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash
            </code>
          </div>
        </div>
      </section>

      {/* Demo */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-xs text-accent mb-10 tracking-widest uppercase">How it works</p>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Telegram mockup */}
            <div className="bg-surface rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-xs text-muted font-mono">Telegram</span>
              </div>
              <div className="p-4 space-y-3 font-mono text-sm">
                <Bubble side="right" text="fix image upload bug in mosun" />
                <Bubble side="left" text={"[mosun-monorepo] 이미지 업로드 버그 수정\n추가했어요"} />
                <Bubble side="right" text="show my todos" />
                <Bubble side="left" text={"[mosun-monorepo]\n1. 이미지 업로드 버그 수정\n2. 모바일 차단 유저 목록\n\n[team-maker]\n1. 세션 불러오기 오류\n2. 배포 버튼화"} />
                <Bubble side="right" text="mosun 1 done" />
                <Bubble side="left" text="완료: 이미지 업로드 버그 수정 (남은 할일 3개)" />
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
                <div className="text-muted text-xs mt-1">&gt; Session started</div>
                <div className="mt-3 border-l-2 border-accent pl-3 py-1.5">
                  <div className="text-accent text-xs mb-1.5">Clauvis &middot; mosun-monorepo</div>
                  <div className="text-foreground text-xs">할일 2개:</div>
                  <div className="text-muted text-xs mt-1">1. 모바일 차단 유저 목록</div>
                  <div className="text-muted text-xs">2. 온보딩 플로우 개선</div>
                </div>
                <div className="mt-4 text-xs">
                  <span className="text-accent">you:</span>{" "}
                  <span className="text-foreground">1번 작업하자</span>
                </div>
                <div className="text-xs text-muted">Working on 모바일 차단 유저 목록...</div>
                <div className="mt-4 text-xs text-muted opacity-50">... 작업 완료 ...</div>
                <div className="mt-4 text-xs">
                  <span className="text-accent">claude:</span>{" "}
                  <span>Clauvis에서 완료 처리할까요?</span>
                </div>
                <div className="text-xs">
                  <span className="text-accent">you:</span>{" "}
                  <span>ㅇㅇ</span>
                </div>
                <div className="text-xs text-green-500">&#10003; 완료 처리됨</div>
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
          <p className="font-mono text-xs text-accent mb-10 tracking-widest uppercase">Features</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden">
            <Card title="Natural language" desc="Type like you think. AI parses project, priority, and deadline from plain text." />
            <Card title="Project-aware" desc="Todos are grouped by project. Open a directory, see only what matters." />
            <Card title="Telegram bot" desc="Add todos from your phone at 2am. Check them on your commute." />
            <Card title="Claude Code MCP" desc="Todos show up when you start coding. Complete them when you're done." />
            <Card title="Context memory" desc="The bot remembers your conversation. 'mark 2 as done' just works." />
            <Card title="Multi-user" desc="Each user gets their own API key and isolated data." />
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-xs text-accent mb-10 tracking-widest uppercase">Setup in 2 minutes</p>
          <div className="space-y-10">
            <Step n="1" title="Get your API key">
              <p className="text-muted text-sm">
                Message{" "}
                <a href="https://t.me/ukth_clauvis_bot" target="_blank" className="text-accent hover:underline">
                  @ukth_clauvis_bot
                </a>{" "}
                on Telegram and send{" "}
                <code className="text-foreground bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono">/start</code>
              </p>
            </Step>
            <Step n="2" title="Install Claude Code integration">
              <div className="bg-surface rounded border border-border p-4 font-mono text-sm group">
                <span className="text-muted">$ </span>
                <span className="text-foreground select-all">
                  curl -sL https://raw.githubusercontent.com/ukth/clauvis/main/scripts/setup.sh | bash
                </span>
              </div>
              <p className="text-muted text-xs mt-3">Sets up MCP server, session hook, and skill.</p>
            </Step>
            <Step n="3" title="Start working">
              <p className="text-muted text-sm">
                Open Claude Code in any project directory. Your todos are already there.
              </p>
            </Step>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-mono text-xs text-muted">clauvis</span>
          <div className="flex items-center gap-6 text-xs text-muted">
            <a href="https://t.me/ukth_clauvis_bot" target="_blank" className="hover:text-foreground transition-colors">Telegram</a>
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
