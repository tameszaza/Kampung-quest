import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { candidateId } = await context.params;
    if (candidateId !== user.id) return NextResponse.json({ error: "You cannot view another member's memory" }, { status: 403 });
    const card = await kampungQuestEngine.getMemory(candidateId);
    if (!card) return NextResponse.json({ error: "Candidate memory not found" }, { status: 404 });
    return NextResponse.json(card);
  } catch (error) {
    return errorResponse(error);
  }
}
