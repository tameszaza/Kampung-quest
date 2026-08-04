import type { UserProfile } from "@/server/identity/types";

/** Demo fixtures are intentionally available only to the named showcase user. */
export function canSeeDemoContent(user: Pick<UserProfile, "username">): boolean {
  return user.username === "test";
}
