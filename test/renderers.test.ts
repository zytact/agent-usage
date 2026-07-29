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

  it("renders enough effort cost precision to explain comparisons", () => {
    const comparisonPricing = { "openai/test": { prompt: 0.001 } };
    const report = buildReport(
      [
        makeSession({
          requests: [
            makeRequest({ effort: "low", input: 69, model: "openai/test", total: 69 }),
            makeRequest({ effort: "medium", input: 70, model: "openai/test", total: 70 }),
          ],
        }),
      ],
      "7d",
      ["codex"],
      new Date("2026-06-14T18:45:00+05:30"),
      comparisonPricing,
    );

    for (const rendered of [
      renderHtmlReport(report, comparisonPricing),
      renderTerminalReport(report, comparisonPricing),
    ]) {
      expect(rendered).toContain("$0.069");
      expect(rendered).toContain("$0.070");
      expect(rendered).toContain("vs medium -1.4%");
    }
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

  it("scales estimated source costs against their total", () => {
    const sourcePricing = { "test/model": { prompt: 0.001 } };
    const report = buildReport(
      [
        makeSession({
          requests: [makeRequest({ input: 100, model: "test/model", total: 100 })],
        }),
        makeSession({
          path: "/tmp/claude-session.jsonl",
          requests: [
            makeRequest({
              input: 50,
              model: "test/model",
              source: "claude",
              sourceLabel: "Claude Code",
              total: 50,
            }),
          ],
          sessionId: "session-2",
          source: "claude",
          sourceLabel: "Claude Code",
        }),
      ],
      "7d",
      ["codex", "claude"],
      new Date("2026-06-14T18:45:00+05:30"),
      sourcePricing,
    );

    const html = renderHtmlReport(report, sourcePricing, "summary", ["source-share"]);

    expect(html).toMatch(/Codex<\/span><b>\$0\.10<\/b>.*?width:66\.7%/s);
    expect(html).toMatch(/Claude Code<\/span><b>\$0\.05<\/b>.*?width:33\.3%/s);
  });

  it("ranks model share by attributed tokens instead of request count", () => {
    const report = buildReport(
      [
        makeSession({
          models: { "high-request-model": 9, "high-token-model": 1 },
          requests: [
            makeRequest({ input: 100, model: "high-request-model", total: 100 }),
            makeRequest({ input: 900, model: "high-token-model", total: 900 }),
          ],
        }),
      ],
      "7d",
      ["codex"],
      new Date("2026-06-14T18:45:00+05:30"),
    );

    const html = renderHtmlReport(report, {}, "summary", ["model-breakdown"]);

    expect(html).toContain("Tokens by model");
    expect(html).toMatch(
      /high-token-model<\/span><b>90% · 900<\/b>.*?width:90\.0%.*?high-request-model<\/span><b>10% · 100<\/b>.*?width:10\.0%/s,
    );
    expect(html).not.toContain("Model mix");
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
    expect(output).toContain("(partial)");
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
          models: { "deepseek-v4-flash-free": 1, "gpt-5.6-sol": 1 },
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
      expect(rendered).toContain("gpt-5.6-sol");
      expect(rendered).toContain("deepseek-v4-flash-free");
      expect(rendered).toContain(
        "Per-model token categories, active time, and cost are unavailable",
      );
      expect(rendered).toContain("Combined mixed workflow usage");
      expect(rendered).toContain("cannot be split by model");
    }
    expect(html).toMatch(
      /gpt-5\.6-sol<\/span><b>59% · 100<\/b>.*?width:58\.8%.*?deepseek-v4-flash-free<\/span><b>41% · 70<\/b>.*?width:41\.2%/s,
    );
    expect(html).not.toContain(">mixed usage</span>");
  });

  it("includes mixed workflow attribution alongside ordinary model token usage", () => {
    const report = buildReport(
      [
        makeSession({
          models: { "workflow-model": 1 },
          path: "/tmp/workflow.jsonl",
          requests: [
            makeRequest({
              model: "mixed usage",
              source: "pi",
              sourceLabel: "Pi",
              total: 300,
            }),
          ],
          sessionId: "workflow",
          source: "pi",
          sourceLabel: "Pi",
          workflowAgentUsage: [
            { effort: "medium", label: "worker", model: "workflow-model", total: 300 },
          ],
        }),
        makeSession({
          path: "/tmp/ordinary.jsonl",
          requests: [makeRequest({ model: "ordinary-model", total: 100 })],
          sessionId: "ordinary",
        }),
      ],
      "7d",
      ["codex", "pi"],
      new Date("2026-06-14T18:45:00+05:30"),
    );

    const html = renderHtmlReport(report, {}, "summary", ["model-breakdown"]);

    expect(html).toMatch(
      /workflow-model<\/span><b>75% · 300<\/b>.*?width:75\.0%.*?ordinary-model<\/span><b>25% · 100<\/b>.*?width:25\.0%/s,
    );
    expect(html).not.toContain(">mixed usage</span>");
  });

  it("renders partial cache-write aggregates truthfully", () => {
    const report = buildReport(
      [
        makeSession({
          requests: [
            makeRequest({
              cacheWrite: 0,
              cacheWriteAvailability: "unknown",
              model: "openai/gpt-5",
              total: 0,
            }),
          ],
          source: "codex",
          sourceLabel: "Codex",
        }),
        makeSession({
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

    expect(output).toContain("write 250 (partial)");
    expect(output).toContain("est $0.0003 (partial)");
    expect(output).not.toContain("write 0");
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
