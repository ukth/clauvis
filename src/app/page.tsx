"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const lang = navigator.language || navigator.languages?.[0] || "en";
    const locale = lang.startsWith("ko") ? "ko" : "en";
    router.replace(`/${locale}`);
  }, [router]);

  return null;
}
