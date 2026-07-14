import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { renderHtmlReport } from "../src/html-report.js";
import { parseClaudeSessionText } from "../src/parsers/claude.js";
import { parseCodexSessionText } from "../src/parsers/codex.js";
import { parsePiSessionText } from "../src/parsers/pi.js";
import { buildReport } from "../src/report-data.js";
import { renderTerminalReport } from "../src/terminal-report.js";
import { makeRequest, makeSession } from "./fixtures.js";

const pricing = {
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

async function makeReport(showOriginators = false) {
  const [codexContent, claudeContent, piContent] = await Promise.all([
    readFile(resolve("test/parsers/codex.fixture.jsonl"), "utf8"),
    readFile(resolve("test/parsers/claude.fixture.jsonl"), "utf8"),
    readFile(resolve("test/parsers/pi.fixture.jsonl"), "utf8"),
  ]);
  const sessions = [
    parseCodexSessionText(codexContent, "codex.jsonl"),
    parseClaudeSessionText(claudeContent, "claude.jsonl"),
    parsePiSessionText(piContent, "pi.jsonl"),
  ].filter((value) => value !== undefined);

  return buildReport(
    sessions,
    "7d",
    ["codex", "opencode", "pi", "claude"],
    new Date("2026-06-14T18:45:00+05:30"),
    pricing,
    showOriginators,
  );
}

describe("renderers", () => {
  it("renders standalone html with all sections", async () => {
    const report = await makeReport();
    const html = renderHtmlReport(report, {}, "summary");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("color-scheme: light dark");
    expect(html).toContain("@media (prefers-color-scheme: light)");
    expect(html).toContain("Agent usage report");
    expect(html).toContain("Combined request summary");
    expect(html).toContain("Per-day tokens and cost");
    expect(html).not.toContain("GPT-only request summary");
    expect(html).not.toContain("Per-day / per-harness / per-model");
    expect(html).toContain("Claude Code");
    expect(html).toContain("<dt>Time</dt>");
    expect(html).toContain("Effort-normalized");
    expect(html).toContain("Cost/req");
    expect(html).toContain("vs medium");
    expect(html).toContain("not exposed by source");
    expect(html).not.toContain("Codex via T3 Code");
    expect(html).toContain("Cost is an estimate.");
  });

  it("renders full html when asked", async () => {
    const report = await makeReport();
    const html = renderHtmlReport(report, {}, "full");

    expect(html).toContain("GPT-only request summary");
    expect(html).toContain("Per-day / per-harness / per-model");
    expect(html).not.toContain("Codex via T3 Code");
  });

  it("renders originator sections when enabled", async () => {
    const report = await makeReport(true);
    const html = renderHtmlReport(report, {}, "summary");

    expect(html).toContain("Codex via T3 Code");
  });

  it("renders custom html section subset", async () => {
    const report = await makeReport();
    const html = renderHtmlReport(report, {}, "summary", ["request-summary", "token-mix"]);

    expect(html).toContain("Combined request summary");
    expect(html).toContain("Token composition");
    expect(html).not.toContain("Per-day tokens and cost");
    expect(html).not.toContain("Source share");
    expect(html).toContain("<b>Custom</b>");
  });

  it("renders terminal dashboard text", async () => {
    const report = await makeReport();
    const output = renderTerminalReport(report, pricing);

    expect(output).toContain("AGENT USAGE DASHBOARD");
    expect(output).toContain("SUMMARY");
    expect(output).toContain("DAILY USAGE");
    expect(output).toContain("Avg tokens/day");
    expect(output).toContain("Tok volatility");
    expect(output).toContain("Source share");
    expect(output).toContain("Token mix");
    expect(output).not.toContain("Legend: input=fresh prompt");
    expect(output).not.toContain("DAILY MODEL BREAKDOWN");
    expect(output).not.toContain("GPT-ONLY");
    expect(output).toContain("time ");
    expect(output).toContain("cost/req");
    expect(output).toContain("vs medium");
    expect(output).toContain("write n/a");
    expect(output).toContain("est $");
    expect(output).toContain("HIGHLIGHTS");
  });

  it("renders terminal full dashboard text", async () => {
    const report = await makeReport();
    const output = renderTerminalReport(report, {}, "full");

    expect(output).toContain("Legend: input=fresh prompt");
    expect(output).toContain("COMBINED REQUEST SUMMARY");
    expect(output).toContain("DAILY USAGE");
    expect(output).toContain("DAILY MODEL BREAKDOWN");
    expect(output).toContain("GPT-ONLY");
    expect(output).toContain("Weighted input eq/req");
  });

  it("shows exact workflow model totals separately from mixed token categories", () => {
    const request = makeRequest({
      cacheRead: 50,
      effort: "mixed",
      input: 100,
      model: "mixed usage",
      output: 20,
      source: "pi",
      sourceLabel: "Pi",
      subharness: "pi",
      total: 170,
    });
    const report = buildReport(
      [
        makeSession({
          originator: "pi-dynamic-workflows",
          requests: [request],
          source: "pi",
          sourceLabel: "Pi",
          workflowAgentUsage: [
            { effort: "low", label: "finder", model: "gpt-5.6-sol", total: 100 },
            {
              effort: "unknown",
              label: "reviewer",
              model: "deepseek-v4-flash-free",
              total: 70,
            },
          ],
        }),
      ],
      "7d",
      ["pi"],
      new Date("2026-06-14T18:45:00+05:30"),
      pricing,
    );
    const html = renderHtmlReport(report, pricing);
    const output = renderTerminalReport(report, pricing);

    for (const rendered of [html, output]) {
      expect(rendered).toContain("Models within mixed usage");
      expect(rendered).toContain("gpt-5.6-sol");
      expect(rendered).toContain("deepseek-v4-flash-free");
      expect(rendered).toContain("Token categories and cost remain combined");
    }
    expect(html).toContain("mixed usage");
  });

  it("hides cache-write totals when availability is mixed", () => {
    const report = buildReport(
      [
        makeSession({
          cacheWriteKnown: false,
          requests: [makeRequest({ cacheWrite: 500, model: "openai/gpt-5", total: 500 })],
          source: "codex",
          sourceLabel: "Codex",
        }),
        makeSession({
          cacheWriteKnown: true,
          requests: [makeRequest({ cacheWrite: 250, model: "openai/gpt-5", total: 250 })],
          sessionId: "session-2",
          source: "pi",
          sourceLabel: "Pi",
        }),
      ],
      "7d",
      ["codex", "pi"],
      new Date("2026-06-14T18:45:00+05:30"),
      pricing,
    );
    const output = renderTerminalReport(report, pricing);

    expect(output).toContain("Cache write     n/a");
    expect(output).toContain("write n/a");
    expect(output).not.toContain("write 750");
  });

  it("renders terminal custom section subset", async () => {
    const report = await makeReport();
    const output = renderTerminalReport(report, pricing, "summary", ["token-mix"]);

    expect(output).toContain("Token mix");
    expect(output).not.toContain("SUMMARY");
    expect(output).not.toContain("DAILY USAGE");
    expect(output).not.toContain("CODEX");
  });

  it("omits daily usage for today", () => {
    const report = buildReport(
      [],
      "today",
      ["codex", "opencode", "pi"],
      new Date("2026-06-14T18:45:00+05:30"),
      pricing,
    );
    const output = renderTerminalReport(report, {});
    const html = renderHtmlReport(report, {});

    expect(output).toContain("SUMMARY");
    expect(output).not.toContain("DAILY USAGE");
    expect(output).toContain("Model requests  0");
    expect(output).toContain("Tokens / active minute");
    expect(output).not.toContain("DAILY MODEL BREAKDOWN");
    expect(output).toContain("No sessions found in this range.");
    expect(html).not.toContain("Per-day tokens and cost");
  });
});
