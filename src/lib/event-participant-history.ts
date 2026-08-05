export function latestInvitationForUser<T extends { guestId: string }>(
  invitations: readonly T[],
  userId: string,
): T | undefined {
  return findLatest(invitations, (invitation) => invitation.guestId === userId);
}

export function latestMembershipForUser<T extends { userId: string }>(
  memberships: readonly T[],
  userId: string,
): T | undefined {
  return findLatest(memberships, (membership) => membership.userId === userId);
}

function findLatest<T>(records: readonly T[], matches: (record: T) => boolean): T | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (matches(records[index])) return records[index];
  }
  return undefined;
}
