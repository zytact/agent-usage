import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parsePiSessionText } from "../../src/parsers/pi.js";

describe("parsePiSessionText", () => {
  it("parses pi session stats from jsonl", async () => {
    const path = resolve("test/parsers/pi.fixture.jsonl");
    const content = await readFile(path, "utf8");

    const session = parsePiSessionText(content, path);

    expect(session).toMatchObject({
      activeSeconds: 41,
      assistantTurns: 2,
      cacheWriteKnown: true,
      cwd: "/home/arnab/Projects/scripts",
      efforts: { high: 1, medium: 1 },
      languages: { Python: 1 },
      modelActiveSeconds: {
        "gpt-5.4": 10,
        "gpt-5.4-mini": 31,
      },
      models: { "gpt-5.4": 2, "gpt-5.4-mini": 2 },
      repo: "scripts",
      requestCount: 2,
      sessionId: "019dc1a2-d71d-77ec-a42a-689f33c942cd",
      source: "pi",
      sourceLabel: "Pi",
      tokens: {
        cacheWrite: 25,
        cached: 100,
        input: 1850,
        output: 152,
        reasoning: 0,
        total: 2127,
      },
      userTurns: 1,
    });

    expect(session?.dayStateActiveSeconds).toEqual({
      "2026-04-24": {
        "gpt-5.4-mini::medium": 31,
        "gpt-5.4::high": 10,
      },
    });

    expect(session?.modelTokens).toEqual({
      "gpt-5.4": {
        billableOutput: 50,
        cacheWrite: 25,
        cached: 100,
        input: 400,
        output: 50,
        reasoning: 0,
        total: 575,
      },
      "gpt-5.4-mini": {
        billableOutput: 102,
        cacheWrite: 0,
        cached: 0,
        input: 1450,
        output: 102,
        reasoning: 0,
        total: 1552,
      },
    });

    expect(session?.requests[0]).toMatchObject({
      cacheRead: 0,
      cacheWrite: 0,
      effort: "medium",
      input: 1450,
      model: "gpt-5.4-mini",
      output: 102,
      total: 1552,
      uncachedInput: 1450,
    });
    expect(session?.requests[1]).toMatchObject({
      cacheRead: 100,
      cacheWrite: 25,
      effort: "high",
      input: 400,
      model: "gpt-5.4",
      output: 50,
      total: 575,
      uncachedInput: 425,
    });
  });
});
