import { logger } from "@/server/observability/logger";

const SLOW_REQUEST_MS = 500;

/** Adds browser-visible phase timings and emits one safe log only for slow requests. */
export class RequestPerformance {
  private readonly startedAt = performance.now();
  private lastMark = this.startedAt;
  private readonly phases: Array<{ name: string; durationMs: number }> = [];

  mark(name: string) {
    const now = performance.now();
    this.phases.push({ name, durationMs: now - this.lastMark });
    this.lastMark = now;
  }

  apply(response: Response, event: string, context: Record<string, string | number | boolean | null> = {}) {
    const totalMs = performance.now() - this.startedAt;
    response.headers.set("server-timing", [
      ...this.phases.map((phase) => `${safeMetricName(phase.name)};dur=${phase.durationMs.toFixed(1)}`),
      `total;dur=${totalMs.toFixed(1)}`,
    ].join(", "));
    if (totalMs >= SLOW_REQUEST_MS) {
      logger.warn(event, {
        ...context,
        durationMs: Math.round(totalMs),
        phases: this.phases.map((phase) => `${phase.name}:${Math.round(phase.durationMs)}`).join(","),
      });
    }
    return response;
  }
}

function safeMetricName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
