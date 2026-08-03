import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { chatUserSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { userId } = chatUserSchema.parse(await request.json());
    await identityStore.blockUser(user.id, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ users: await identityStore.listBlockedUsers(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const { userId } = chatUserSchema.parse(await request.json());
    await identityStore.unblockUser(user.id, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
