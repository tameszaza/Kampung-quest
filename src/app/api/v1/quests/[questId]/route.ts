import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";

interface RouteContext {
  params: Promise<{ questId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  const { questId } = await context.params;
  const run = await kampungQuestEngine.getQuest(questId);
  if (!run) return NextResponse.json({ error: "Quest run not found" }, { status: 404 });
  return NextResponse.json(run);
}
