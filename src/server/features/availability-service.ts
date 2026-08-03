import type { AvailabilityWindow, WeeklyAvailabilityRule } from "@/server/domain/schemas";
import type { AvailabilityHorizon } from "@/server/domain/event-coordination";

export function expandAvailability(input: {
  explicitWindows: AvailabilityWindow[];
  recurringRules: WeeklyAvailabilityRule[];
  horizon: AvailabilityHorizon;
}): AvailabilityWindow[] {
  const horizonStart = startOfUtcDate(input.horizon.start);
  const horizonEnd = endOfUtcDate(input.horizon.end);
  if (horizonEnd < horizonStart) throw new Error("Availability horizon end must not precede its start");

  const expanded = input.explicitWindows
    .filter((window) => Date.parse(window.end) > Date.parse(window.start))
    .filter((window) => Date.parse(window.start) <= horizonEnd && Date.parse(window.end) >= horizonStart)
    .map((window) => ({ ...window }));

  for (const rule of input.recurringRules) {
    validateRule(rule);
    const validStart = Math.max(horizonStart, startOfUtcDate(rule.validFrom));
    const validEnd = Math.min(horizonEnd, endOfUtcDate(rule.validUntil));
    for (let cursor = validStart; cursor <= validEnd; cursor += 86_400_000) {
      const date = new Date(cursor);
      const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
      if (!rule.daysOfWeek.includes(isoWeekday)) continue;
      const dateText = date.toISOString().slice(0, 10);
      const start = zonedLocalTimeToIso(dateText, rule.startLocalTime, rule.timeZone);
      let end = zonedLocalTimeToIso(dateText, rule.endLocalTime, rule.timeZone);
      if (Date.parse(end) <= Date.parse(start)) {
        const nextDate = new Date(cursor + 86_400_000).toISOString().slice(0, 10);
        end = zonedLocalTimeToIso(nextDate, rule.endLocalTime, rule.timeZone);
      }
      expanded.push({ start, end });
    }
  }

  return mergeWindows(expanded);
}

export function findCommonAvailability(
  windowsByParticipant: AvailabilityWindow[][],
  durationMinutes: number,
): AvailabilityWindow | null {
  if (!windowsByParticipant.length || windowsByParticipant.some((windows) => windows.length === 0)) return null;
  let overlaps = mergeWindows(windowsByParticipant[0]);
  for (const windows of windowsByParticipant.slice(1)) {
    const next: AvailabilityWindow[] = [];
    for (const left of overlaps) {
      for (const right of windows) {
        const start = Math.max(Date.parse(left.start), Date.parse(right.start));
        const end = Math.min(Date.parse(left.end), Date.parse(right.end));
        if (end > start) next.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      }
    }
    overlaps = mergeWindows(next);
  }
  const requiredMs = durationMinutes * 60_000;
  const match = overlaps.find((window) => Date.parse(window.end) - Date.parse(window.start) >= requiredMs);
  return match ? { start: match.start, end: new Date(Date.parse(match.start) + requiredMs).toISOString() } : null;
}

function validateRule(rule: WeeklyAvailabilityRule) {
  if (!rule.daysOfWeek.length || rule.daysOfWeek.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error("Recurring availability requires valid weekdays");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.startLocalTime)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.endLocalTime)) {
    throw new Error("Recurring availability requires 24-hour local times");
  }
  if (endOfUtcDate(rule.validUntil) < startOfUtcDate(rule.validFrom)) {
    throw new Error("Recurring availability validity end must not precede its start");
  }
  new Intl.DateTimeFormat("en-CA", { timeZone: rule.timeZone }).format(new Date());
}

function startOfUtcDate(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) throw new Error("Availability dates must use YYYY-MM-DD");
  return parsed;
}

function endOfUtcDate(value: string): number {
  return startOfUtcDate(value) + 86_400_000 - 1;
}

function zonedLocalTimeToIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let instant = targetWallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timeZoneOffsetMs(new Date(instant), timeZone);
    const next = targetWallClock - offset;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant).toISOString();
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return represented - instant.getTime();
}

function mergeWindows(windows: AvailabilityWindow[]): AvailabilityWindow[] {
  const sorted = windows
    .map((window) => ({ start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() }))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  const merged: AvailabilityWindow[] = [];
  for (const window of sorted) {
    const previous = merged.at(-1);
    if (previous && Date.parse(window.start) <= Date.parse(previous.end)) {
      if (Date.parse(window.end) > Date.parse(previous.end)) previous.end = window.end;
    } else {
      merged.push(window);
    }
  }
  return merged;
}
