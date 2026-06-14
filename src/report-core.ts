export const ACTIVE_GAP_SECONDS = 15 * 60;

export type Scope = "today" | "1d" | "7d" | "30d";

export type EventMark = {
  effort?: string;
  model?: string;
  ts: Date;
};

export function parseTimestamp(value: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace("Z", "+00:00");
  const ts = new Date(normalized);
  if (Number.isNaN(ts.getTime())) {
    return undefined;
  }
  return ts;
}

export function parseEpochMs(value: number | string | null | undefined): Date | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }

  const millis = raw > 10_000_000_000 ? raw : raw * 1000;
  const ts = new Date(millis);
  if (Number.isNaN(ts.getTime())) {
    return undefined;
  }
  return ts;
}

export function scopeStart(scope: Scope, now: Date): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (scope === "today") {
    return new Date(year, month, day, 0, 0, 0, 0);
  }
  if (scope === "1d") {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const days = scope === "7d" ? 6 : 29;
  return new Date(year, month, day - days, 0, 0, 0, 0);
}

export function activeSeconds(events: Date[]): number {
  const ordered = [...events].sort((a, b) => a.getTime() - b.getTime());
  let active = 0;

  for (let index = 1; index < ordered.length; index += 1) {
    const delta = Math.floor((ordered[index].getTime() - ordered[index - 1].getTime()) / 1000);
    if (delta > 0) {
      active += Math.min(delta, ACTIVE_GAP_SECONDS);
    }
  }

  return active || 60;
}

export function stateKey(model?: string, effort?: string): string {
  return `${model ?? "unknown"}::${effort ?? "unknown"}`;
}

export function splitStateKey(value: string): { effort: string; model: string } {
  const index = value.indexOf("::");
  if (index === -1) {
    return { effort: "unknown", model: value };
  }

  return {
    model: value.slice(0, index),
    effort: value.slice(index + 2),
  };
}

export function splitIntervalByDay(start: Date, end: Date): Array<[Date, Date]> {
  const segments: Array<[Date, Date]> = [];
  let current = new Date(start);

  while (
    current.getUTCFullYear() !== end.getUTCFullYear() ||
    current.getUTCMonth() !== end.getUTCMonth() ||
    current.getUTCDate() !== end.getUTCDate()
  ) {
    const midnight = new Date(current);
    midnight.setUTCHours(24, 0, 0, 0);
    segments.push([new Date(current), midnight]);
    current = midnight;
  }

  segments.push([new Date(current), new Date(end)]);
  return segments;
}

export function allocateStateTime(eventMarks: EventMark[]): {
  byDayStateSeconds: Record<string, Record<string, number>>;
  byStateSeconds: Record<string, number>;
  totalSeconds: number;
} {
  if (eventMarks.length === 0) {
    return {
      byDayStateSeconds: {},
      byStateSeconds: {},
      totalSeconds: 60,
    };
  }

  const ordered = [...eventMarks].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const byStateSeconds: Record<string, number> = {};
  const byDayStateSeconds: Record<string, Record<string, number>> = {};
  let totalSeconds = 0;

  for (let index = 1; index < ordered.length; index += 1) {
    const prev = ordered[index - 1];
    const current = ordered[index];
    const delta = Math.floor((current.ts.getTime() - prev.ts.getTime()) / 1000);
    if (delta <= 0) {
      continue;
    }

    const used = Math.min(delta, ACTIVE_GAP_SECONDS);
    totalSeconds += used;
    const key = stateKey(prev.model, prev.effort);
    const intervalEnd = new Date(prev.ts.getTime() + used * 1000);

    for (const [segmentStart, segmentEnd] of splitIntervalByDay(prev.ts, intervalEnd)) {
      const seconds = Math.floor((segmentEnd.getTime() - segmentStart.getTime()) / 1000);
      if (seconds <= 0) {
        continue;
      }

      byStateSeconds[key] = (byStateSeconds[key] ?? 0) + seconds;
      const day = segmentStart.toISOString().slice(0, 10);
      byDayStateSeconds[day] ??= {};
      byDayStateSeconds[day][key] = (byDayStateSeconds[day][key] ?? 0) + seconds;
    }
  }

  if (totalSeconds === 0) {
    const fallback = ordered[ordered.length - 1];
    const key = stateKey(fallback.model, fallback.effort);
    const day = fallback.ts.toISOString().slice(0, 10);
    byStateSeconds[key] = (byStateSeconds[key] ?? 0) + 60;
    byDayStateSeconds[day] ??= {};
    byDayStateSeconds[day][key] = (byDayStateSeconds[day][key] ?? 0) + 60;
    totalSeconds = 60;
  }

  return { byDayStateSeconds, byStateSeconds, totalSeconds };
}

export function collapseStateSeconds(
  stateSeconds: Record<string, number> | undefined,
): Record<string, number> {
  const collapsed: Record<string, number> = {};

  for (const [key, seconds] of Object.entries(stateSeconds ?? {})) {
    const { model } = splitStateKey(key);
    collapsed[model] = (collapsed[model] ?? 0) + seconds;
  }

  return collapsed;
}

export function collapseDayStateSeconds(
  dayStateSeconds: Record<string, Record<string, number>> | undefined,
): Record<string, Record<string, number>> {
  const collapsed: Record<string, Record<string, number>> = {};

  for (const [day, stateSeconds] of Object.entries(dayStateSeconds ?? {})) {
    collapsed[day] = collapseStateSeconds(stateSeconds);
  }

  return collapsed;
}

export function humanSeconds(total: number): string {
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

export function compactTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

export function mean(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(values: number[], pct: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) {
    return ordered[0];
  }

  const rank = (ordered.length - 1) * pct;
  const low = Math.floor(rank);
  const high = Math.min(low + 1, ordered.length - 1);
  const frac = rank - low;
  return ordered[low] + (ordered[high] - ordered[low]) * frac;
}
