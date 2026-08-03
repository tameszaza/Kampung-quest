import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { passwordSchema } from "@/server/identity/schemas";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/invalid password|incorrect password/i.test(message)) return "Your current password is not correct.";
  if (/credential.*not found/i.test(message)) return "This account does not have a password yet.";
  if (/too short/i.test(message)) return "Use at least 8 characters, including a letter and a number.";
  if (/too long/i.test(message)) return "Use no more than 128 characters.";
  return "We could not update your password. Please try again.";
}

export async function POST(request: Request) {
  try {
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return NextResponse.json({ error: "Please sign in again before changing your password." }, { status: 401 });
    const body = await request.json() as { currentPassword?: string; newPassword?: string; revokeOtherSessions?: boolean };
    const newPassword = body.newPassword ?? "";
    const checked = passwordSchema.safeParse(newPassword);
    if (!checked.success) return NextResponse.json({ error: checked.error.issues[0]?.message ?? "Choose a stronger password." }, { status: 400 });
    if (body.currentPassword && body.currentPassword === newPassword) {
      return NextResponse.json({ error: "Your new password must be different from your current password." }, { status: 400 });
    }

    const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
    const hasCredential = accounts.some((account) => account.providerId === "credential");
    if (hasCredential) {
      if (!body.currentPassword) return NextResponse.json({ error: "Enter your current password first." }, { status: 400 });
      await auth.api.changePassword({
        headers: requestHeaders,
        body: {
          currentPassword: body.currentPassword,
          newPassword,
          revokeOtherSessions: Boolean(body.revokeOtherSessions),
        },
      });
    } else {
      await auth.api.setPassword({ headers: requestHeaders, body: { newPassword } });
      if (body.revokeOtherSessions) await auth.api.revokeOtherSessions({ headers: requestHeaders });
    }
    return NextResponse.json({ ok: true, hasPassword: true, message: hasCredential ? "Your password has been changed." : "A password has been added to your account." });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
