import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { randomBytes } from "crypto";

export async function POST(request: NextRequest) {
  if (!process.env.ADMIN_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const adminKey = authHeader.slice(7);
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name } = body;

  const apiKey = `clv_${randomBytes(24).toString("hex")}`;

  const [user] = await db
    .insert(users)
    .values({ name, apiKey })
    .returning();

  return NextResponse.json(user);
}
