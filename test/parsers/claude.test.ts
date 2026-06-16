import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseClaudeSessionText } from "../../src/parsers/claude.js";

describe("parseClaudeSessionText", () => {
  it("parses claude session stats from jsonl", async () => {
    const path = resolve("test/parsers/claude.fixture.jsonl");
    const content = await readFile(path, "utf8");

    const session = parseClaudeSessionText(content, path);

    expect(session).toMatchObject({
      activeSeconds: 327,
      assistantTurns: 3,
      cwd: "/home/arnab/Projects/instaext",
      efforts: {},
      languages: { JSON: 1, TypeScript: 2 },
      modelActiveSeconds: { "claude-sonnet-4-6": 324 },
      models: { "claude-sonnet-4-6": 2 },
      repo: "instaext",
      requestCount: 2,
      sessionId: "f107b789-8529-4779-930b-89f553a70519",
      source: "claude",
      sourceLabel: "Claude Code",
      tokens: {
        cacheWrite: 29056,
        cached: 0,
        input: 4,
        output: 862,
        reasoning: 0,
        total: 30179,
      },
      userTurns: 1,
    });

    expect(session?.modelTokens).toEqual({
      "claude-sonnet-4-6": {
        billableOutput: 862,
        cacheWrite: 29056,
        cached: 0,
        input: 4,
        output: 862,
        reasoning: 0,
        total: 30179,
      },
    });

    expect(session?.dayStateActiveSeconds).toEqual({
      "2026-05-01": {
        "claude-sonnet-4-6::unknown": 324,
        "unknown::unknown": 3,
      },
    });

    expect(session?.requests[0]).toMatchObject({
      cacheRead: 0,
      cacheWrite: 11946,
      input: 3,
      model: "claude-sonnet-4-6",
      output: 257,
      reasoning: 0,
      total: 12463,
    });
    expect(session?.requests[1]).toMatchObject({
      cacheRead: 0,
      cacheWrite: 17110,
      input: 1,
      model: "claude-sonnet-4-6",
      output: 605,
      reasoning: 0,
      total: 17716,
    });
  });
});
