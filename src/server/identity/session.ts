import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { identityStore } from "@/server/identity/container";
import { publicUser, type UserProfile } from "@/server/identity/types";

type BetterAuthUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  username?: string | null;
};

export async function currentUser(): Promise<UserProfile | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const authUser = session.user as BetterAuthUser;
  const existing = await identityStore.findUserById(authUser.id);
  if (existing) return publicUser(existing);
  return identityStore.ensureAuthUser({
    id: authUser.id,
    fullName: authUser.name,
    email: authUser.email,
    photoUrl: authUser.image ?? null,
    username: authUser.username ?? null,
  });
}

export async function requireUser(): Promise<UserProfile> {
  const user = await currentUser();
  if (!user) throw new Error("Authentication required");
  return user;
}
