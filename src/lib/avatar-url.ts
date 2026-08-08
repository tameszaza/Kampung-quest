/** Local avatars are already optimized by the server's avatar route. */
export function isLocalAvatarUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value, "http://localhost").pathname.startsWith("/api/profile/avatar/");
  } catch {
    return false;
  }
}
