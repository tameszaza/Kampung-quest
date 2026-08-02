import { NextResponse } from "next/server";
import { endSession } from "@/server/identity/session";

export async function POST() {
  await endSession();
  return NextResponse.json({ success: true });
}

