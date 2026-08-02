import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { identityStore } from "@/server/identity/container";
import type { UserProfile } from "@/server/identity/types";

export const SESSION_COOKIE = "senior_quest_session";
const SESSION_DAYS = 30;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export async function startSession(userId: string, rememberMe = true): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (rememberMe ? SESSION_DAYS * 24 : 12) * 60 * 60 * 1000);
  await identityStore.createSession(hashSessionToken(token), userId, expiresAt);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: rememberMe ? expiresAt : undefined,
  });
}

export async function currentUser(): Promise<UserProfile | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? identityStore.findUserBySession(hashSessionToken(token)) : null;
}

export async function requireUser(): Promise<UserProfile> {
  const user = await currentUser();
  if (!user) throw new Error("Authentication required");
  return user;
}

export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await identityStore.deleteSession(hashSessionToken(token));
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
