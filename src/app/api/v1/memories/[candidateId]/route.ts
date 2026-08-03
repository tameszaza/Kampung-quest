import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  const { candidateId } = await context.params;
  const card = await kampungQuestEngine.getMemory(candidateId);
  if (!card) return NextResponse.json({ error: "Candidate memory not found" }, { status: 404 });
  return NextResponse.json(card);
}
