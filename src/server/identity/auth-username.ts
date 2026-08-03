import { betterAuthPool } from "@/lib/auth";
import { normalizeUsername } from "@/server/identity/username";

/**
 * Better Auth's availability endpoint intentionally treats the current owner
 * as unavailable. Profile onboarding needs the owner-aware variant so a user
 * can submit the username that was already assigned during sign-up.
 */
export async function isAuthUsernameAvailable(username: string, excludeUserId?: string) {
  const result = await betterAuthPool.query<{ id: string }>(
    'SELECT "id" FROM auth."user" WHERE lower("username") = $1 LIMIT 1',
    [normalizeUsername(username)],
  );
  return !result.rows[0] || result.rows[0].id === excludeUserId;
}
