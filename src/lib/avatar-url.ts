/** Local avatars are already optimized by the server's avatar route. */
export function isLocalAvatarUrl(value: string | null | undefined): boolean {
  return value?.startsWith("/api/profile/avatar/") === true;
}
