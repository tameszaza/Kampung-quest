type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, boolean | number | string | null | undefined>;

const priority: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
const minimumPriority = priority[configuredLevel] ?? priority.info;

/** Small JSON logger for server diagnostics. Never pass secrets or user text. */
export const logger = {
  debug(event: string, context: LogContext = {}) { write("debug", event, context); },
  info(event: string, context: LogContext = {}) { write("info", event, context); },
  warn(event: string, context: LogContext = {}) { write("warn", event, context); },
  error(event: string, context: LogContext = {}) { write("error", event, context); },
};

function write(level: LogLevel, event: string, context: LogContext) {
  if (priority[level] < minimumPriority) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: "kampung-quest",
    event,
    ...context,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}
