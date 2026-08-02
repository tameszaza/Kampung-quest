import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { boundedLimit } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { candidateId } = await context.params;
    if (candidateId !== user.id) return NextResponse.json({ error: "You cannot retrieve matches for another member" }, { status: 403 });
    const card = await kampungQuestEngine.getMemory(candidateId);
    if (!card) return NextResponse.json({ error: "Initiating candidate not found" }, { status: 404 });

    const limit = boundedLimit(new URL(request.url).searchParams.get("limit"));
    return NextResponse.json(await kampungQuestEngine.retrieveCandidates({ initiatingCandidateId: candidateId, limit }));
  } catch (error) {
    return errorResponse(error);
  }
}
