import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const PUBLIC_SEGMENTS = new Set(["telegram", "mcp", "users", "cron"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Routes that authenticate themselves (cron uses CRON_SECRET). Match whole path segments only.
  const segment = pathname.split("/")[2];
  if (PUBLIC_SEGMENTS.has(segment)) {
    // Never let a client-supplied x-user-id through to self-authenticating routes
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-user-id");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const authHeader = request.headers.get("authorization");
  const apiKey = authHeader?.replace("Bearer ", "");

  if (!apiKey) {
    console.log(`[MW] ${pathname} unauth`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id FROM users WHERE api_key = ${apiKey} LIMIT 1`;

  if (result.length === 0) {
    console.log(`[MW] ${pathname} invalid_key`);
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  console.log(`[MW] ${pathname} user=${result[0].id.slice(0, 4)}`);
  // Forward the authenticated id as a *request* header so route handlers can read it.
  // Overwrites any client-supplied x-user-id, which would otherwise allow impersonation.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", result[0].id);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/api/((?!(?:telegram|mcp|users|cron)(?:/|$)).*)",
  ],
};
