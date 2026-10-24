import { SessionRefresh } from "../session-refresh";
import { TabBar } from "../_components/tab-bar";

// Shell for the signed-in tabs. Each page still checks the session itself (layouts are not
// re-rendered on client navigation, so they cannot be the only guard).
export default function LedgerTabsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px] pb-[calc(96px+env(safe-area-inset-bottom))]">
      <SessionRefresh />
      {children}
      <TabBar />
    </div>
  );
}
