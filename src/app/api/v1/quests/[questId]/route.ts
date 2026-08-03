import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ questId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const run = await kampungQuestEngine.getQuest(questId);
    if (!run) return NextResponse.json({ error: "Quest run not found" }, { status: 404 });
    if (run.initiatingCandidateId !== user.id) return NextResponse.json({ error: "You cannot view another member's quest" }, { status: 403 });
    return NextResponse.json(run);
  } catch (error) {
    return errorResponse(error);
  }
}
