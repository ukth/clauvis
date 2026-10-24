import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Clauvis 가계부",
  description: "텔레그램으로 간편하게 연결하는 나의 가계부",
  manifest: "/ledger/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Clauvis 가계부",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [{ url: "/ledger/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0F1E",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="ko" className="min-h-dvh flex-1 bg-[#0A0F1E] text-[#EEF1FA]">
      {children}
    </div>
  );
}
