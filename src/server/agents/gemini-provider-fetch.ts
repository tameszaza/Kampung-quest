interface GeminiError {
  code?: number;
  message?: string;
  status?: string;
  details?: Array<Record<string, unknown>>;
}

interface GeminiErrorEnvelope {
  error: GeminiError;
}

export function createGeminiCompatibleFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.ok) return response;

    const payload = await response.clone().json().catch(() => null) as unknown;
    const envelope = findErrorEnvelope(payload);
    if (!envelope) return response;

    const headers = new Headers(response.headers);
    if (isDailyQuota(envelope.error)) {
      headers.set("x-gemini-quota-period", "day");
      headers.delete("retry-after");
    } else {
      const retryDelayMs = findRetryDelayMs(envelope.error);
      if (retryDelayMs !== null && !headers.has("retry-after")) {
        headers.set("retry-after", String(Math.ceil(retryDelayMs / 1_000)));
      }
    }
    headers.set("content-type", "application/json");

    return new Response(JSON.stringify(envelope), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function findErrorEnvelope(payload: unknown): GeminiErrorEnvelope | null {
  const candidate = Array.isArray(payload) ? payload[0] : payload;
  if (!candidate || typeof candidate !== "object" || !("error" in candidate)) return null;
  const error = candidate.error;
  if (!error || typeof error !== "object") return null;
  return { error: error as GeminiError };
}

function findRetryDelayMs(error: GeminiError): number | null {
  const retryInfo = error.details?.find((detail) =>
    detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
  );
  const retryDelay = retryInfo?.retryDelay;
  if (typeof retryDelay === "string") return durationToMilliseconds(retryDelay);

  const messageMatch = error.message?.match(/retry in ([0-9.]+)s/i);
  return messageMatch?.[1] ? Number.parseFloat(messageMatch[1]) * 1_000 : null;
}

function isDailyQuota(error: GeminiError): boolean {
  return error.details?.some((detail) => {
    const violations = detail.violations;
    return Array.isArray(violations) && violations.some((violation) =>
      violation
      && typeof violation === "object"
      && "quotaId" in violation
      && typeof violation.quotaId === "string"
      && violation.quotaId.includes("PerDay")
    );
  }) ?? false;
}

function durationToMilliseconds(duration: string): number | null {
  const match = duration.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match?.[1] ? Number.parseFloat(match[1]) * 1_000 : null;
}
