"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartBarIcon, Cog6ToothIcon, HomeIcon, ListBulletIcon, SparklesIcon } from "@heroicons/react/24/outline";

const TABS = [
  { href: "/ledger", label: "홈", Icon: HomeIcon },
  { href: "/ledger/transactions", label: "내역", Icon: ListBulletIcon },
  { href: "/ledger/chat", label: "AI", Icon: SparklesIcon },
  { href: "/ledger/trends", label: "추이", Icon: ChartBarIcon },
  { href: "/ledger/settings", label: "설정", Icon: Cog6ToothIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="가계부 메뉴" className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
      <div className="mx-auto flex h-[60px] max-w-[448px] gap-1 rounded-[30px] border border-[#243055] bg-[#1A2342]/90 p-1.5 backdrop-blur-xl">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/ledger" ? pathname === "/ledger" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-3xl text-[10px] ${active ? "bg-[#4C7BF3]/15 font-semibold text-[#4C7BF3]" : "text-[#8A93AD]"}`}
            >
              <Icon aria-hidden="true" className="size-5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
