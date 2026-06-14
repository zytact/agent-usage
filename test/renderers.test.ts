import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { renderHtmlReport } from "../src/html-report.js";
import { parseClaudeSessionText } from "../src/parsers/claude.js";
import { parseCodexSessionText } from "../src/parsers/codex.js";
import { parsePiSessionText } from "../src/parsers/pi.js";
import { buildReport } from "../src/report-data.js";
import { renderTerminalReport } from "../src/terminal-report.js";

async function makeReport() {
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

  return buildReport(sessions, "7d", true, new Date("2026-06-14T18:45:00+05:30"));
}

describe("renderers", () => {
  it("renders standalone html with all sections", async () => {
    const report = await makeReport();
    const html = renderHtmlReport(report, {});

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("color-scheme: dark");
    expect(html).toContain("Agent usage report");
    expect(html).toContain("Combined request summary");
    expect(html).toContain("Per-day / per-harness / per-model");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Cost is an estimate.");
  });

  it("renders terminal dashboard text", async () => {
    const report = await makeReport();
    const output = renderTerminalReport(report, {});

    expect(output).toContain("AGENT USAGE DASHBOARD");
    expect(output).toContain("COMBINED");
    expect(output).toContain("GPT-ONLY");
    expect(output).toContain("HIGHLIGHTS");
  });
});
