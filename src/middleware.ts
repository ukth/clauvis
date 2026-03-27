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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id FROM users WHERE api_key = ${apiKey} LIMIT 1`;

  if (result.length === 0) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const response = NextResponse.next();
  response.headers.set("x-user-id", result[0].id);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
