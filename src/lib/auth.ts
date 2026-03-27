import { NextRequest } from "next/server";

export function getUserId(request: NextRequest): string {
  return request.headers.get("x-user-id")!;
}
