import { isAuthUsernameAvailable } from "@/server/identity/auth-username";
import { identityStore } from "@/server/identity/container";
import { normalizeUsername } from "@/server/identity/username";
import { currentUser } from "@/server/identity/session";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("username")?.trim() ?? "";
  if (normalizeUsername(value).length < 3) return Response.json({ available: false });
  const user = await currentUser();
  const current = Boolean(user?.username && normalizeUsername(user.username) === normalizeUsername(value));
  const [authAvailable, appAvailable] = await Promise.all([
    isAuthUsernameAvailable(value, user?.id),
    identityStore.isUsernameAvailable(value, user?.id),
  ]);
  return Response.json({ available: authAvailable && appAvailable, current });
}
