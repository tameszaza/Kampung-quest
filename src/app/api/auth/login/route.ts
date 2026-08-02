import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { hashPassword, verifyPassword } from "@/server/identity/password";
import { loginSchema } from "@/server/identity/schemas";
import { startSession } from "@/server/identity/session";
import { publicUser } from "@/server/identity/types";
import { errorResponse } from "@/server/http/responses";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const user = await identityStore.findUserByIdentifier(input.identifier);
    const valid = user?.passwordHash
      ? await verifyPassword(input.password, user.passwordHash)
      : (await hashPassword(input.password), false);
    if (!user || !valid) {
      return NextResponse.json({ error: "Email, phone number, or password is incorrect" }, { status: 401 });
    }
    await startSession(user.id, input.rememberMe);
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    return errorResponse(error);
  }
}
