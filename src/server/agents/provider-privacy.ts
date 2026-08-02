import { createHash } from "node:crypto";

export type MemoryFactKind = "need" | "interest" | "offer";

export function stableFactRef(kind: MemoryFactKind, text: string): string {
  const digest = createHash("sha256")
    .update(text.trim().toLocaleLowerCase("en"))
    .digest("hex")
    .slice(0, 16);
  return `${kind}_${digest}`;
}

export function minimizeProviderInput<T>(value: T, field?: string): T {
  if (typeof value === "string") {
    if ((field === "start" || field === "end") && !Number.isNaN(Date.parse(value))) return value;
    return redactText(value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => minimizeProviderInput(item, field)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, minimizeProviderInput(item, key)]),
    ) as T;
  }
  return value;
}

export function redactText(value: string): string {
  return value
    .replace(/\b(my name is|name:)\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2}/gi, "$1 [redacted_name]")
    .replace(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2}\b/g, "[redacted_name]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted_email]")
    .replace(/(?:\+\d{1,3}[ ()-]?(?:\d[ ()-]?){7,12}\d|\b[689]\d{3}[ -]?\d{4}\b)/g, "[redacted_phone]")
    .replace(/\b(?:blk|block)\s+\d+[A-Za-z]?\s+[A-Za-z0-9 ]{2,50}(?:st|street|ave|avenue|rd|road|dr|drive)\s*\d*\b(?:\s*#[0-9-]+)?/gi, "[redacted_address]")
    .replace(/\b\d{1,5}\s+[A-Za-z0-9.' -]{2,40}\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b/gi, "[redacted_address]")
    .replace(/#\d{2}-\d{2,3}\b/g, "[redacted_unit]")
    .replace(/\b(?:Singapore\s*)?\d{6}\b/gi, "[redacted_postal_code]")
    .replace(/\b(?:candidate|senior|user)[_-][A-Za-z0-9_-]+\b/gi, "[redacted_participant_id]");
}
