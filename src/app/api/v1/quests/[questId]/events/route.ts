import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

interface RouteContext {
  params: Promise<{ questId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    await requireUser();
    await context.params;
    return NextResponse.json({
      error: "This legacy coordination endpoint has been retired. Use the event quest roster, invitation, coordination, arrangement, and lifecycle endpoints.",
    }, { status: 410 });
  } catch (error) {
    return errorResponse(error);
  }
}
