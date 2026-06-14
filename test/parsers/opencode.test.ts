import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseOpencodeRows } from "../../src/parsers/opencode.js";

describe("parseOpencodeRows", () => {
  it("parses opencode sessions from session/message rows", async () => {
    const [sessionRows, messageRows] = await Promise.all([
      readJson(resolve("test/parsers/opencode.sessions.json")),
      readJson(resolve("test/parsers/opencode.messages.json")),
    ]);

    const sessions = await parseOpencodeRows({
      dbPath: "/tmp/opencode.db",
      messageRows,
      sessionRows,
    });

    expect(sessions).toHaveLength(2);

    expect(sessions[0]).toMatchObject({
      activeSeconds: 64,
      assistantTurns: 1,
      cwd: "/home/arnab/Projects/scripts",
      efforts: { medium: 2 },
      languages: { Python: 1 },
      modelActiveSeconds: { "deepseek-v4-flash-free": 10, unknown: 54 },
      models: { "deepseek-v4-flash-free": 1 },
      originator: "t3code_desktop",
      path: "/tmp/opencode.db",
      repo: "scripts",
      requestCount: 1,
      sessionId: "ses_13fbbf5b1ffeGCb57Tzqf13iHK",
      source: "opencode",
      sourceLabel: "T3 Code",
      tokens: {
        cacheWrite: 0,
        cached: 10496,
        input: 2772,
        output: 173,
        reasoning: 997,
        total: 14438,
      },
      userTurns: 1,
    });

    expect(sessions[0]?.requests[0]).toMatchObject({
      cacheRead: 10496,
      contextSize: 13268,
      effort: "medium",
      input: 2772,
      model: "deepseek-v4-flash-free",
      output: 173,
      reasoning: 997,
      sourceLabel: "T3 Code",
      subharness: "t3code",
      total: 14438,
    });

    expect(sessions[0]?.dayStateActiveSeconds).toEqual({
      "2026-06-13": {
        "deepseek-v4-flash-free::medium": 10,
        "unknown::medium": 5,
        "unknown::unknown": 49,
      },
    });

    expect(sessions[1]).toMatchObject({
      activeSeconds: 5,
      assistantTurns: 0,
      cwd: "/home/arnab/Projects/agent-usage",
      efforts: { low: 1 },
      modelTokens: {
        "qwen-coder": {
          billableOutput: 35,
          cacheWrite: 2,
          cached: 5,
          input: 50,
          output: 25,
          reasoning: 10,
          total: 92,
        },
      },
      models: { "qwen-coder": 1 },
      originator: "opencode",
      requestCount: 0,
      sessionId: "ses_fallback_only",
      sourceLabel: "opencode",
      tokens: {
        cacheWrite: 2,
        cached: 5,
        input: 50,
        output: 25,
        reasoning: 10,
        total: 92,
      },
      userTurns: 0,
    });
  });
});

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}
