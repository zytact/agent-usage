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

  it("infers opencode originators from title and metadata", async () => {
    const sessions = await parseOpencodeRows({
      dbPath: "/tmp/opencode.db",
      messageRows: [
        assistantMessage("ses_meta_t3", 1718881200000),
        assistantMessage("ses_title_subagent", 1718881260000),
        assistantMessage("ses_meta_subagent", 1718881320000),
      ],
      sessionRows: [
        makeSessionRow("ses_meta_t3", {
          metadata: '{"client":"t3code"}',
          title: "Regular session",
        }),
        makeSessionRow("ses_title_subagent", {
          title: "Fix bug (@worker-subagent)",
        }),
        makeSessionRow("ses_meta_subagent", {
          metadata: '{"originator":"subagent"}',
          title: "Regular session",
        }),
      ],
    });

    expect(sessions.map((session) => session.originator)).toEqual([
      "t3code_desktop",
      "subagent",
      "subagent",
    ]);
    expect(sessions.map((session) => session.sourceLabel)).toEqual([
      "T3 Code",
      "opencode",
      "opencode",
    ]);
    expect(sessions[1]?.requests[0]).toMatchObject({
      sourceLabel: "opencode",
      subharness: "opencode",
    });
  });
});

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

function makeSessionRow(
  id: string,
  overrides: Partial<{ metadata: string | null; title: string }> = {},
) {
  return {
    directory: "/tmp/demo",
    id,
    metadata: null,
    model: '{"id":"gpt-5","providerID":"opencode","variant":"medium"}',
    time_created: 1718881200000,
    time_updated: 1718881205000,
    title: "Regular session",
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    ...overrides,
  };
}

function assistantMessage(session_id: string, time: number) {
  return {
    data: JSON.stringify({
      modelID: "gpt-5",
      path: { cwd: "/tmp/demo", root: "/tmp/demo" },
      role: "assistant",
      time: { completed: time + 1000, created: time },
      tokens: { cache: { read: 0, write: 0 }, input: 1, output: 2, reasoning: 3, total: 6 },
      variant: "medium",
    }),
    session_id,
    time_created: time,
    time_updated: time + 1000,
  };
}
