import { NextResponse } from "next/server";
import { currentUser } from "@/server/identity/session";

export async function GET() {
  const user = await currentUser();
  return user
    ? NextResponse.json({ user })
    : NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

