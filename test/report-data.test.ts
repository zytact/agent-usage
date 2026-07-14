import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseClaudeSessionText } from "../src/parsers/claude.js";
import { parseCodexSessionText } from "../src/parsers/codex.js";
import { parsePiSessionText } from "../src/parsers/pi.js";
import {
  buildReport,
  estimateStatsTotalCost,
  modelEffortBreakdowns,
  type PricingInfo,
  workflowModelAttributions,
} from "../src/report-data.js";
import { makeRequest, makeSession } from "./fixtures.js";

const pricing: Record<string, PricingInfo> = {
  "anthropic/claude-sonnet-4.6": {
    cacheRead: 0.0000003,
    cacheWrite: 0.000003,
    completion: 0.000015,
    prompt: 0.000003,
  },
  "openai/gpt-5": {
    cacheRead: 0.000000125,
    cacheWrite: 0.00000125,
    completion: 0.00001,
    prompt: 0.00000125,
  },
  "openai/gpt-5-mini": {
    cacheRead: 0.000000025,
    cacheWrite: 0.00000025,
    completion: 0.000002,
    prompt: 0.00000025,
  },
};

async function loadFixtureSessions() {
  const [codexContent, claudeContent, piContent] = await Promise.all([
    readFile(resolve("test/parsers/codex.fixture.jsonl"), "utf8"),
    readFile(resolve("test/parsers/claude.fixture.jsonl"), "utf8"),
    readFile(resolve("test/parsers/pi.fixture.jsonl"), "utf8"),
  ]);

  return [
    parseCodexSessionText(codexContent, "codex.jsonl"),
    parseClaudeSessionText(claudeContent, "claude.jsonl"),
    parsePiSessionText(piContent, "pi.jsonl"),
  ].filter((value) => value !== undefined);
}

describe("buildReport", () => {
  it("builds source sections and daily rows", async () => {
    const sessions = await loadFixtureSessions();
    const report = buildReport(
      sessions,
      "30d",
      ["codex", "opencode", "pi", "claude"],
      new Date("2026-06-14T18:45:00+05:30"),
      pricing,
    );

    expect(report.scopeTitle).toBe("Last 30 Days · since 2026-05-16");
    expect(report.sourceCount).toBe(4);
    expect(report.sections.map((section) => section.title)).toEqual([
      "Combined",
      "GPT-only",
      "Codex",
      "opencode",
      "Claude Code",
      "Pi",
    ]);
    expect(report.combined.stats.sessionCount).toBe(1);
    expect(report.combined.stats.tokens.total).toBeGreaterThan(0);
    expect(report.dailyRows[0]).toMatchObject({
      date: "2026-06-14",
      harness: "codex",
    });
    expect(report.dailyUsage.rows.find((row) => row.date === "2026-06-14")).toMatchObject({
      date: "2026-06-14",
      tokens: 3100,
    });
    expect(report.dailyUsage.avgTokens).toBeGreaterThan(0);
    expect(report.dailyUsage.activeDayAvgTokens).toBeGreaterThan(0);
    expect(report.dailyUsage.tokenMedian).toBeGreaterThan(0);
    expect(report.dailyUsage.tokenP90).toBeGreaterThan(0);
    expect(report.dailyUsage.tokenVolatility).toBeDefined();
    expect(report.dailyUsage.tokenVolatility).toBeGreaterThanOrEqual(0);
    expect(report.dailyUsage.avgCost).toBeGreaterThan(0);
    expect(report.dailyUsage.activeDayAvgCost).toBeGreaterThan(0);
    expect(report.dailyUsage.costMedian).toBeGreaterThan(0);
    expect(report.dailyUsage.costP90).toBeGreaterThan(0);
    expect(report.dailyUsage.costVolatility).toBeDefined();
    expect(report.dailyUsage.costVolatility).toBeGreaterThanOrEqual(0);
  });

  it("adds originator sections when asked", () => {
    const sessions = [
      makeSession({ originator: "t3code_desktop", source: "codex", sourceLabel: "T3 Code" }),
      makeSession({
        originator: "Codex Desktop",
        sessionId: "session-2",
        source: "codex",
        sourceLabel: "codex",
      }),
      makeSession({
        originator: "subagent",
        sessionId: "session-3",
        source: "claude",
        sourceLabel: "Claude Code",
      }),
    ];
    const report = buildReport(
      sessions,
      "30d",
      ["codex", "claude"],
      new Date("2026-06-14T18:45:00+05:30"),
      pricing,
      true,
    );

    expect(report.showOriginators).toBe(true);
    expect(report.sections.map((section) => section.title)).toEqual([
      "Combined",
      "GPT-only",
      "Codex",
      "Codex via Desktop",
      "Codex via T3 Code",
      "Claude Code",
      "Claude Code via Subagent",
    ]);
  });

  it("formats last-day scope as rolling 24 hours", async () => {
    const sessions = await loadFixtureSessions();
    const report = buildReport(
      sessions,
      "1d",
      ["codex", "opencode", "pi", "claude"],
      new Date("2026-06-14T18:45:00+05:30"),
      pricing,
    );

    expect(report.scopeTitle).toBe("Last 24 Hours · since 2026-06-13 13:15 UTC");
    expect(report.dailyUsage.rows.map((row) => row.date)).toEqual(["2026-06-13", "2026-06-14"]);
  });

  it("estimates cost when rates exist", async () => {
    const sessions = await loadFixtureSessions();
    const report = buildReport(
      sessions,
      "30d",
      ["codex", "opencode", "pi", "claude"],
      new Date("2026-06-14T18:45:00+05:30"),
      pricing,
    );
    const cost = estimateStatsTotalCost(report.combined.stats, pricing);

    expect(cost).toBeGreaterThan(0);
  });

  it("reports exact agent totals separately from mixed workflow usage", () => {
    const mixedRequest = makeRequest({ effort: "mixed", model: "mixed usage", total: 170 });
    const session = makeSession({
      requests: [mixedRequest],
      workflowAgentUsage: [
        { effort: "low", label: "finder", model: "gpt-5.6-sol", total: 100 },
        { effort: "unknown", label: "reviewer", model: "deepseek-v4-flash-free", total: 70 },
      ],
    });

    expect(workflowModelAttributions([session])).toEqual([
      { effort: "low", model: "gpt-5.6-sol", pct: (100 / 170) * 100, total: 100 },
      {
        effort: "unknown",
        model: "deepseek-v4-flash-free",
        pct: (70 / 170) * 100,
        total: 70,
      },
    ]);
  });

  it("builds normalized effort breakdowns per model", () => {
    const requests = [
      makeRequest({
        contextSize: 1000,
        effort: "medium",
        input: 800,
        model: "gpt-5",
        output: 300,
        reasoning: 40,
        total: 1340,
      }),
      makeRequest({
        contextSize: 1400,
        effort: "high",
        input: 900,
        model: "gpt-5",
        output: 360,
        reasoning: 80,
        total: 1640,
      }),
    ];
    const session = makeSession({
      requests,
      stateActiveSeconds: { "gpt-5::high": 480, "gpt-5::medium": 360 },
    });
    const rows = modelEffortBreakdowns([session], pricing, 5);
    const gpt5 = rows.find((row) => row.model === "gpt-5");

    expect(gpt5?.effortRows[0]).toMatchObject({
      effort: "medium",
      requests: 1,
      tokensPerRequest: 1340,
      outputPerRequest: 300,
      reasoningPerRequest: 40,
      contextPerRequest: 1000,
      activeSecondsPerRequest: 360,
      costPerMinuteUplift: 0,
      costPerRequestUplift: 0,
      tokensPerRequestUplift: 0,
    });
    expect(gpt5?.effortRows[1]).toMatchObject({
      effort: "high",
      requests: 1,
      costPerRequestUplift: 0.2556818181818181,
      costPerMinuteUplift: -0.058238636363636354,
      outputPerRequestUplift: 0.19999999999999996,
      reasoningPerRequestUplift: 1,
      tokensPerRequestUplift: 0.22388059701492535,
      contextPerRequestUplift: 0.3999999999999999,
    });
  });
});
