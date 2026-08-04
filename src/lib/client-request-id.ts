let fallbackSequence = 0;

/**
 * Generates correlation and idempotency IDs in browsers where randomUUID is
 * unavailable, including Safari pages served from a non-secure LAN origin.
 * These IDs identify client requests; they are not authentication secrets.
 */
export function createClientRequestId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
  return [
    "client",
    Date.now().toString(36),
    fallbackSequence.toString(36),
    Math.random().toString(36).slice(2),
  ].join("-");
}
