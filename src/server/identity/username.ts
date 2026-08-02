export function normalizeUsername(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .replace(/[._-]{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
}

export function isValidDisplayName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3
    && trimmed.length <= 40
    && /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(trimmed)
    && normalizeUsername(trimmed).length >= 3;
}
