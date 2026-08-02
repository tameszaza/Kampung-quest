import { createHash } from "node:crypto";

export type MemoryFactKind = "need" | "interest" | "offer";

export function stableFactRef(kind: MemoryFactKind, text: string): string {
  const digest = createHash("sha256")
    .update(text.trim().toLocaleLowerCase("en"))
    .digest("hex")
    .slice(0, 16);
  return `${kind}_${digest}`;
}

export function minimizeProviderInput<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => minimizeProviderInput(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, minimizeProviderInput(item)]),
    ) as T;
  }
  return value;
}

export function redactText(value: string): string {
  return value
    .replace(/\b(my name is|name:)\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2}/gi, "$1 [redacted_name]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted_email]")
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[redacted_phone]")
    .replace(/\b\d{1,5}\s+[A-Za-z0-9.' -]{2,40}\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b/gi, "[redacted_address]")
    .replace(/\b(?:candidate|senior|user)[_-][A-Za-z0-9_-]+\b/gi, "[redacted_participant_id]");
}
