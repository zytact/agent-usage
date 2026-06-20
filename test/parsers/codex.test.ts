import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseCodexSessionText } from "../../src/parsers/codex.js";

describe("parseCodexSessionText", () => {
  it("parses codex session stats from jsonl", async () => {
    const path = resolve("test/parsers/codex.fixture.jsonl");
    const content = await readFile(path, "utf8");

    const session = parseCodexSessionText(content, path);

    expect(session).toMatchObject({
      activeSeconds: 758,
      assistantTurns: 1,
      cacheWriteKnown: false,
      cwd: "/home/arnab/Projects/agent-usage",
      efforts: { high: 1, medium: 1 },
      languages: { Markdown: 1, TypeScript: 1 },
      modelActiveSeconds: {
        "gpt-5": 338,
        "gpt-5-mini": 420,
      },
      models: { "gpt-5": 1, "gpt-5-mini": 1 },
      originator: "t3code_desktop",
      repo: "agent-usage",
      requestCount: 2,
      sessionId: "019ec570-6eb1-7953-9fcb-9cc33afdf6d7",
      source: "codex",
      sourceLabel: "T3 Code",
      tokens: {
        cacheWrite: 0,
        cached: 500,
        input: 1500,
        output: 700,
        reasoning: 100,
        total: 2700,
      },
      userTurns: 1,
    });

    expect(session?.dayStateActiveSeconds).toEqual({
      "2026-06-14": {
        "gpt-5::medium": 338,
        "gpt-5-mini::high": 420,
      },
    });

    expect(session?.modelTokens).toEqual({
      "gpt-5": {
        billableOutput: 350,
        cacheWrite: 0,
        cached: 250,
        input: 750,
        output: 350,
        reasoning: 50,
        total: 1350,
      },
      "gpt-5-mini": {
        billableOutput: 350,
        cacheWrite: 0,
        cached: 250,
        input: 750,
        output: 350,
        reasoning: 50,
        total: 1350,
      },
    });

    expect(session?.requests).toHaveLength(2);
    expect(session?.requests[0]).toMatchObject({
      cacheRead: 200,
      contextSize: 1000,
      effort: "medium",
      input: 800,
      model: "gpt-5",
      output: 300,
      reasoning: 40,
      sessionId: "019ec570-6eb1-7953-9fcb-9cc33afdf6d7",
      sourceLabel: "T3 Code",
      subharness: "t3code",
      total: 1340,
      uncachedInput: 800,
    });
    expect(session?.requests[1]).toMatchObject({
      cacheRead: 300,
      contextSize: 1000,
      effort: "high",
      input: 700,
      model: "gpt-5-mini",
      output: 400,
      reasoning: 60,
      total: 1760,
    });
  });
});
