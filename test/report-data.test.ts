import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseClaudeSessionText } from "../src/parsers/claude.js";
import { parseCodexSessionText } from "../src/parsers/codex.js";
import { parsePiSessionText } from "../src/parsers/pi.js";
import { buildReport, estimateStatsTotalCost } from "../src/report-data.js";

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
    const report = buildReport(sessions, "30d", true, new Date("2026-06-14T18:45:00+05:30"));

    expect(report.scopeTitle).toBe("Last 30 Days · since 2026-05-16");
    expect(report.sourceCount).toBe(4);
    expect(report.sections.map((section) => section.title)).toEqual([
      "Combined",
      "GPT-only",
      "Codex",
      "Codex via T3 Code",
      "Codex other",
      "opencode",
      "opencode via T3 Code",
      "opencode other",
      "Claude Code",
      "Pi",
    ]);
    expect(report.combined.stats.sessionCount).toBe(1);
    expect(report.combined.stats.tokens.total).toBeGreaterThan(0);
    expect(report.dailyRows[0]).toMatchObject({
      date: "2026-06-14",
      harness: "codex",
    });
  });

  it("formats last-day scope as rolling 24 hours", async () => {
    const sessions = await loadFixtureSessions();
    const report = buildReport(sessions, "1d", true, new Date("2026-06-14T18:45:00+05:30"));

    expect(report.scopeTitle).toBe("Last 24 Hours · since 2026-06-13 13:15 UTC");
  });

  it("estimates cost when rates exist", async () => {
    const sessions = await loadFixtureSessions();
    const report = buildReport(sessions, "30d", true, new Date("2026-06-14T18:45:00+05:30"));
    const cost = estimateStatsTotalCost(report.combined.stats, {
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
    });

    expect(cost).toBeGreaterThan(0);
  });
});
