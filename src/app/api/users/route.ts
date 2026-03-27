import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { randomBytes } from "crypto";

export async function POST(request: NextRequest) {
  const adminKey = request.headers.get("authorization")?.replace("Bearer ", "");
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
