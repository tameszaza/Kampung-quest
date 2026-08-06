export type TimestampedChatMessage = {
  createdAt: string;
  messageId: string;
};

/** Returns the newest message across all chat scopes for one activity. */
export function latestChatMessage<T extends TimestampedChatMessage>(...groups: T[][]) {
  return groups.flat().reduce<T | undefined>((latest, message) => !latest
    || message.createdAt.localeCompare(latest.createdAt) > 0
    || (message.createdAt === latest.createdAt && message.messageId.localeCompare(latest.messageId) > 0)
    ? message
    : latest, undefined);
}
