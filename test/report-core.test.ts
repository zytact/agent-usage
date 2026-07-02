import { describe, expect, it } from "vite-plus/test";

import {
  ACTIVE_GAP_SECONDS,
  activeSeconds,
  allocateStateTime,
  collapseDayStateSeconds,
  collapseStateSeconds,
  coefficientOfVariation,
  compactTokens,
  humanSeconds,
  mean,
  parseEpochMs,
  parseTimestamp,
  percentile,
  scopeStart,
  splitIntervalByDay,
  splitStateKey,
  stateKey,
} from "../src/report-core.js";

describe("report-core", () => {
  it("parses iso timestamps", () => {
    expect(parseTimestamp("2026-06-14T10:30:00Z")?.toISOString()).toBe("2026-06-14T10:30:00.000Z");
    expect(parseTimestamp("")).toBeUndefined();
    expect(parseTimestamp("bad")).toBeUndefined();
  });

  it("parses epoch timestamps in seconds and millis", () => {
    expect(parseEpochMs(1_718_360_200)?.toISOString()).toBe("2024-06-14T10:16:40.000Z");
    expect(parseEpochMs(1_718_360_200_000)?.toISOString()).toBe("2024-06-14T10:16:40.000Z");
    expect(parseEpochMs(0)).toBeUndefined();
  });

  it("computes scope starts", () => {
    const now = new Date(2026, 5, 14, 18, 45, 0, 0);
    expect(scopeStart("today", now).getTime()).toBe(new Date(2026, 5, 14, 0, 0, 0, 0).getTime());
    expect(scopeStart("1d", now).getTime()).toBe(new Date(2026, 5, 13, 18, 45, 0, 0).getTime());
    expect(scopeStart("7d", now).getTime()).toBe(new Date(2026, 5, 8, 0, 0, 0, 0).getTime());
    expect(scopeStart("30d", now).getTime()).toBe(new Date(2026, 4, 16, 0, 0, 0, 0).getTime());
  });

  it("computes capped active seconds", () => {
    const base = new Date("2026-06-14T10:00:00.000Z");
    const later = new Date(base.getTime() + 5 * 60 * 1000);
    const muchLater = new Date(base.getTime() + 60 * 60 * 1000);
    expect(activeSeconds([muchLater, base, later])).toBe(5 * 60 + ACTIVE_GAP_SECONDS);
    expect(activeSeconds([base])).toBe(60);
  });

  it("builds and splits state keys", () => {
    expect(stateKey("gpt-5", "high")).toBe("gpt-5::high");
    expect(stateKey()).toBe("unknown::unknown");
    expect(splitStateKey("gpt-5::high")).toEqual({ effort: "high", model: "gpt-5" });
    expect(splitStateKey("gpt-5")).toEqual({ effort: "unknown", model: "gpt-5" });
  });

  it("splits intervals across day boundaries", () => {
    const parts = splitIntervalByDay(
      new Date("2026-06-14T23:55:00.000Z"),
      new Date("2026-06-15T00:05:00.000Z"),
    );
    expect(parts).toHaveLength(2);
    expect(parts[0][0].toISOString()).toBe("2026-06-14T23:55:00.000Z");
    expect(parts[0][1].toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(parts[1][0].toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(parts[1][1].toISOString()).toBe("2026-06-15T00:05:00.000Z");
  });

  it("allocates state time and collapses by model", () => {
    const allocated = allocateStateTime([
      { effort: "medium", model: "gpt-5", ts: new Date("2026-06-14T23:55:00.000Z") },
      { effort: "medium", model: "gpt-5", ts: new Date("2026-06-15T00:05:00.000Z") },
      { effort: "high", model: "gpt-5", ts: new Date("2026-06-15T00:05:00.000Z") },
      { effort: "high", model: "gpt-5", ts: new Date("2026-06-15T00:10:00.000Z") },
    ]);

    expect(allocated.totalSeconds).toBe(15 * 60);
    expect(allocated.byStateSeconds).toEqual({
      "gpt-5::high": 5 * 60,
      "gpt-5::medium": 10 * 60,
    });
    expect(allocated.byDayStateSeconds).toEqual({
      "2026-06-14": { "gpt-5::medium": 5 * 60 },
      "2026-06-15": { "gpt-5::high": 5 * 60, "gpt-5::medium": 5 * 60 },
    });
    expect(collapseStateSeconds(allocated.byStateSeconds)).toEqual({ "gpt-5": 15 * 60 });
    expect(collapseDayStateSeconds(allocated.byDayStateSeconds)).toEqual({
      "2026-06-14": { "gpt-5": 5 * 60 },
      "2026-06-15": { "gpt-5": 10 * 60 },
    });
  });

  it("falls back to 60 seconds for a single mark", () => {
    const allocated = allocateStateTime([
      { effort: "low", model: "gpt-5", ts: new Date("2026-06-14T10:00:00.000Z") },
    ]);

    expect(allocated.totalSeconds).toBe(60);
    expect(allocated.byStateSeconds).toEqual({ "gpt-5::low": 60 });
    expect(allocated.byDayStateSeconds).toEqual({
      "2026-06-14": { "gpt-5::low": 60 },
    });
  });

  it("formats durations and token counts", () => {
    expect(humanSeconds(0)).toBe("0m");
    expect(humanSeconds(59)).toBe("<1m");
    expect(humanSeconds(3_720)).toBe("1h 2m");
    expect(compactTokens(999)).toBe("999");
    expect(compactTokens(12_300)).toBe("12.3k");
    expect(compactTokens(1_250_000)).toBe("1.25M");
  });

  it("computes mean and percentile", () => {
    expect(mean([])).toBeUndefined();
    expect(mean([2, 4, 6])).toBe(4);
    expect(coefficientOfVariation([])).toBeUndefined();
    expect(coefficientOfVariation([0, 0])).toBeUndefined();
    expect(coefficientOfVariation([10, 20, 30])).toBeCloseTo(0.408248, 6);
    expect(percentile([], 0.95)).toBeUndefined();
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([10, 20, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 40, 50], 0.75)).toBe(42.5);
  });
});
