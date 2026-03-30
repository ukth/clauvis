import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clauvis — Todo manager for developers",
  description: "Open source todo manager for developers. Telegram bot + Claude Code MCP. Free command mode, BYOK agent mode.",
  metadataBase: new URL("https://clauvis.backproach.dev"),
  openGraph: {
    title: "Clauvis — Your todos, where you actually work.",
    description: "Open source todo manager for developers. Telegram bot + Claude Code MCP. Free command mode, BYOK agent mode.",
    url: "https://clauvis.backproach.dev",
    siteName: "Clauvis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clauvis — Todo manager for developers",
    description: "Open source todo manager for developers. Telegram bot + Claude Code MCP.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
