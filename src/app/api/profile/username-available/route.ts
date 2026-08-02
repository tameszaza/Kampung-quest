import { auth } from "@/lib/auth";
import { identityStore } from "@/server/identity/container";
import { normalizeUsername } from "@/server/identity/username";
import { currentUser } from "@/server/identity/session";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("username")?.trim() ?? "";
  if (normalizeUsername(value).length < 3) return Response.json({ available: false });
  const user = await currentUser();
  const current = Boolean(user?.username && normalizeUsername(user.username) === normalizeUsername(value));
  const [authResult, appAvailable] = await Promise.all([
    current ? Promise.resolve({ available: true }) : auth.api.isUsernameAvailable({ body: { username: value } }),
    identityStore.isUsernameAvailable(value, user?.id),
  ]);
  return Response.json({ available: authResult.available && appAvailable, current });
}
