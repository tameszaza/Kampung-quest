import { NextResponse } from "next/server";
import { memoryService } from "@/server/container";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  const { candidateId } = await context.params;
  const card = memoryService.recall(candidateId);
  if (!card) return NextResponse.json({ error: "Candidate memory not found" }, { status: 404 });
  return NextResponse.json(card);
}
