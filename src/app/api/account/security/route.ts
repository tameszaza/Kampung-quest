import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

function unauthorized() {
  return NextResponse.json({ error: "Please sign in again to manage account security." }, { status: 401 });
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() }) as Promise<AuthSession>;
}

export async function GET() {
  try {
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return unauthorized();
    const [accounts, sessions] = await Promise.all([
      auth.api.listUserAccounts({ headers: requestHeaders }),
      auth.api.listSessions({ headers: requestHeaders }),
    ]);
    return NextResponse.json({
      hasPassword: accounts.some((account) => account.providerId === "credential"),
      providers: accounts.map((account) => account.providerId),
      sessions: sessions
        .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((item) => ({
          id: item.id,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          expiresAt: item.expiresAt,
          userAgent: item.userAgent ?? null,
          current: item.id === session.session.id,
        })),
    });
  } catch {
    return NextResponse.json({ error: "Could not load your security details." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    const body = await request.json() as { action?: string; sessionId?: string };
    const requestHeaders = await headers();

    if (body.action === "revoke-other-sessions") {
      await auth.api.revokeOtherSessions({ headers: requestHeaders });
      return NextResponse.json({ ok: true, message: "All other signed-in devices have been signed out." });
    }

    if (body.action === "revoke-session" && body.sessionId) {
      if (body.sessionId === session.session.id) {
        return NextResponse.json({ error: "This device is currently in use. Use Log Out when you are ready to leave it." }, { status: 400 });
      }
      const sessions = await auth.api.listSessions({ headers: requestHeaders });
      const target = sessions.find((item) => item.id === body.sessionId);
      if (!target) return NextResponse.json({ error: "That session has already expired or been signed out." }, { status: 404 });
      await auth.api.revokeSession({ headers: requestHeaders, body: { token: target.token } });
      return NextResponse.json({ ok: true, message: "The selected device has been signed out." });
    }

    return NextResponse.json({ error: "Choose a security action first." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "That security action could not be completed. Please try again." }, { status: 500 });
  }
}
