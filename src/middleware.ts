import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api/telegram" || pathname === "/api/users" || pathname === "/api/mcp") {
    return NextResponse.next();
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
  const response = NextResponse.next();
  response.headers.set("x-user-id", result[0].id);
  return response;
}

export const config = {
  matcher: [
    "/api/((?!telegram|mcp|users).*)",
  ],
};
