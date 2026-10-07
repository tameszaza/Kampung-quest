import { AiControlError, type AiPolicy } from "@/server/security/ai-policy";
import { AI_CALL_TIMEOUT_MS, type AiUsageStore } from "@/server/security/ai-usage-store";
import { logger } from "@/server/observability/logger";

interface ControlledFetchOptions {
  store: AiUsageStore;
  policy: AiPolicy;
  resolveActor: () => Promise<string | null>;
  models: readonly string[];
  fetch?: typeof fetch;
}

/** All billable HTTP attempts, including SDK retries, pass this boundary. */
export function createAiControlledFetch(options: ControlledFetchOptions): typeof fetch {
  const baseFetch = options.fetch ?? globalThis.fetch;
  return async (input, init) => {
    let leaseId: string | undefined;
    try {
      const actor = await options.resolveActor();
      if (!actor) throw new AiControlError("AI_AUTH_REQUIRED");
      const url = new URL(input instanceof Request ? input.url : String(input));
      const path = url.pathname.replace(/\/$/, "");
      const embedding = path.endsWith("/embeddings");
      const responses = path.endsWith("/responses");
      if (!(embedding || responses || path.endsWith("/chat/completions"))
        || (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "POST"
        || typeof init?.body !== "string") throw new AiControlError("AI_REQUEST_UNSUPPORTED");
      if (Buffer.byteLength(init.body) > options.policy.maxInputBytes) throw new AiControlError("AI_INPUT_TOO_LARGE");
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(init.body); }
      catch { throw new AiControlError("AI_REQUEST_UNSUPPORTED"); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || typeof payload.model !== "string" || !options.models.includes(payload.model)
        || payload.stream === true) throw new AiControlError("AI_REQUEST_UNSUPPORTED");
      let outputTokens = 0;
      if (!embedding) {
        const key = responses ? "max_output_tokens" : "max_tokens";
        const requested = payload.max_completion_tokens ?? payload[key];
        outputTokens = typeof requested === "number" && Number.isSafeInteger(requested) && requested > 0
          ? Math.min(requested, options.policy.maxOutputTokens)
          : options.policy.maxOutputTokens;
        delete payload.max_completion_tokens;
        payload[key] = outputTokens;
        if ((Array.isArray(payload.tools) && payload.tools.length > 0)
          || payload.modalities || payload.audio) throw new AiControlError("AI_REQUEST_UNSUPPORTED");
      }
      const body = JSON.stringify(payload);
      if (Buffer.byteLength(body) > options.policy.maxInputBytes) throw new AiControlError("AI_INPUT_TOO_LARGE");
      // Bytes upper-estimate text tokens; retain reservations even on failed calls.
      const costMicros = Math.ceil((Buffer.byteLength(body) + 1_024) * options.policy.inputUsdPerMillionTokens
        + outputTokens * options.policy.outputUsdPerMillionTokens);
      if (!Number.isSafeInteger(costMicros) || costMicros <= 0) throw new AiControlError("AI_GUARD_UNAVAILABLE", 30);
      leaseId = await options.store.reserve(actor, costMicros, options.policy);
      const timeout = AbortSignal.timeout(AI_CALL_TIMEOUT_MS);
      const signals = [timeout, ...(init.signal ? [init.signal] : [])];
      const response = await baseFetch(input, { ...init, body, signal: AbortSignal.any(signals) });
      // Hold concurrency admission until the body is read, not just until headers.
      const bytes = await readBoundedResponse(response, 4 * 1024 * 1024);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      if (leaseId && !(error instanceof AiControlError)) throw error;
      const failure = error instanceof AiControlError ? error : new AiControlError("AI_GUARD_UNAVAILABLE", 30);
      logger.warn("ai.admission.denied", { code: failure.code });
      const headers = new Headers({ "content-type": "application/json", "x-should-retry": "false" });
      if (failure.retryAfter) headers.set("retry-after", String(failure.retryAfter));
      return new Response(JSON.stringify({ error: { message: failure.message, code: failure.code, type: "application_ai_limit" } }),
        { status: failure.status, headers });
    } finally {
      if (leaseId) await options.store.release(leaseId).catch(() => {
        logger.warn("ai.lease.release_failed");
      });
    }
  };
}

async function readBoundedResponse(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("AI provider response exceeded its size limit");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
