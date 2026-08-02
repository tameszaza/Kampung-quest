import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 50);
    return NextResponse.json({ contacts: await identityStore.listContacts(user.id, query) });
  } catch (error) {
    return errorResponse(error);
  }
}
