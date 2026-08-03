import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { preferenceUpdateSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const input = preferenceUpdateSchema.parse(await request.json());
    return NextResponse.json({ user: await identityStore.updatePreferences(user.id, input) });
  } catch (error) {
    return errorResponse(error);
  }
}

