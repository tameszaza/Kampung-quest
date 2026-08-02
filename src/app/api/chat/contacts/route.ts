import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ contacts: await identityStore.listContacts(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

