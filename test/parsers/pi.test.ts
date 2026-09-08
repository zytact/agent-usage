import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parsePiSessionText } from "../../src/parsers/pi.js";
import { calendarDate } from "../../src/report-core.js";

describe("parsePiSessionText", () => {
  it("parses pi session stats from jsonl", async () => {
    const path = resolve("test/parsers/pi.fixture.jsonl");
    const content = await readFile(path, "utf8");

    const session = parsePiSessionText(content, path);

    expect(session).toMatchObject({
      activeSeconds: 41,
      assistantTurns: 2,
      cacheWriteAvailability: "known",
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
      reasoningAvailability: "partial",
      sessionId: "019dc1a2-d71d-77ec-a42a-689f33c942cd",
      source: "pi",
      sourceLabel: "Pi",
      tokens: {
        cacheWrite: 25,
        cached: 100,
        input: 1850,
        output: 152,
        reasoning: 15,
        total: 2127,
      },
      userTurns: 1,
    });

    expect(session?.dayStateActiveSeconds).toEqual({
      [calendarDate(new Date("2026-04-24T22:36:33.924Z"))]: {
        "gpt-5.4-mini::medium": 31,
        "gpt-5.4::high": 10,
      },
    });

    expect(session?.modelTokens).toEqual({
      "gpt-5.4": {
        billableOutput: 65,
        cacheWrite: 25,
        cacheWrite1h: 0,
        cached: 100,
        input: 400,
        output: 50,
        reasoning: 15,
        total: 575,
      },
      "gpt-5.4-mini": {
        billableOutput: 102,
        cacheWrite: 0,
        cacheWrite1h: 0,
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
      reasoningAvailability: "unknown",
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
      reasoning: 15,
      reasoningAvailability: "known",
      total: 575,
      uncachedInput: 425,
    });
  });

  it("preserves an explicit reasoning zero as known", () => {
    const session = parsePiSessionText(
      [
        JSON.stringify({ type: "session", id: "pi-zero", timestamp: "2026-04-24T22:36:00.000Z" }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-24T22:36:01.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.4",
            usage: { input: 10, output: 5, reasoning: 0, totalTokens: 15 },
          },
        }),
      ].join("\n"),
    );

    expect(session).toMatchObject({ reasoningAvailability: "known" });
    expect(session?.requests[0]).toMatchObject({
      reasoning: 0,
      reasoningAvailability: "known",
    });
  });

  it("treats a forked parent session as a normal session, not a subagent", () => {
    const session = parsePiSessionText(
      [
        JSON.stringify({
          type: "session",
          id: "pi-fork",
          timestamp: "2026-04-24T22:36:00.000Z",
          cwd: "/repo",
          originator: "direct",
          parentSession: "/parent.jsonl",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-24T22:36:01.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.4",
            usage: { input: 10, output: 5, totalTokens: 15 },
          },
        }),
      ].join("\n"),
    );

    expect(session).toMatchObject({
      originator: "direct",
      sourceLabel: "Pi",
    });
    expect(session?.requests[0]).toMatchObject({
      sourceLabel: "Pi",
      subharness: "pi",
    });
  });

  it("ignores history a fork copied from its parent session", () => {
    const inherited = JSON.stringify({
      type: "message",
      timestamp: "2026-04-24T22:00:00.000Z",
      message: {
        role: "assistant",
        model: "gpt-5.4",
        usage: { input: 100, output: 60, totalTokens: 160 },
      },
    });
    const own = JSON.stringify({
      type: "message",
      timestamp: "2026-04-24T22:40:00.000Z",
      message: {
        role: "assistant",
        model: "gpt-5.4",
        usage: { input: 20, output: 10, totalTokens: 30 },
      },
    });
    const header = JSON.stringify({
      type: "session",
      id: "pi-fork",
      timestamp: "2026-04-24T22:36:00.000Z",
      cwd: "/repo",
      parentSession: "/parent.jsonl",
    });

    const forked = parsePiSessionText([header, inherited, own].join("\n"));

    expect(forked?.requestCount).toBe(1);
    expect(forked?.tokens).toMatchObject({ input: 20, output: 10, total: 30 });
  });

  it("drops a fork that only ever held its parent's history", () => {
    const session = parsePiSessionText(
      [
        JSON.stringify({
          type: "session",
          id: "pi-empty-fork",
          timestamp: "2026-04-24T22:36:00.000Z",
          cwd: "/repo",
          parentSession: "/parent.jsonl",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-24T22:00:00.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.4",
            usage: { input: 100, output: 60, totalTokens: 160 },
          },
        }),
      ].join("\n"),
    );

    expect(session).toBeUndefined();
  });

  it("counts compaction, branch summary, and tool result usage as requests", () => {
    const session = parsePiSessionText(
      [
        JSON.stringify({
          type: "session",
          id: "pi-aux",
          timestamp: "2026-04-24T22:36:00.000Z",
          cwd: "/repo",
        }),
        JSON.stringify({
          type: "model_change",
          timestamp: "2026-04-24T22:36:01.000Z",
          provider: "openai-codex",
          modelId: "gpt-5.4",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-24T22:36:02.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.4",
            provider: "openai-codex",
            usage: { input: 10, output: 5, totalTokens: 15 },
          },
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-24T22:36:03.000Z",
          message: { role: "toolResult", usage: { input: 4, output: 1, totalTokens: 5 } },
        }),
        JSON.stringify({
          type: "compaction",
          timestamp: "2026-04-24T22:36:04.000Z",
          summary: "so far",
          firstKeptEntryId: "abc",
          tokensBefore: 1000,
          usage: { input: 200, output: 20, totalTokens: 220 },
        }),
        JSON.stringify({
          type: "branch_summary",
          timestamp: "2026-04-24T22:36:05.000Z",
          fromId: "abc",
          summary: "abandoned path",
          usage: { input: 30, output: 3, totalTokens: 33 },
        }),
      ].join("\n"),
    );

    expect(session?.requestCount).toBe(4);
    expect(session?.tokens).toMatchObject({ input: 244, output: 29, total: 273 });
    expect(sumRequestTotals(session)).toBe(session?.tokens.total);
    expect(session?.modelTokens["gpt-5.4"]).toMatchObject({
      provider: "openai-codex",
      total: 273,
    });
    expect(session?.requests.map((request) => request.provider)).toEqual([
      "openai-codex",
      "openai-codex",
      "openai-codex",
      "openai-codex",
    ]);
  });

  it("unsets the model provider when providers disagree", () => {
    const session = parsePiSessionText(
      [
        JSON.stringify({
          type: "session",
          id: "pi-mixed",
          timestamp: "2026-04-24T22:36:00.000Z",
          cwd: "/repo",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-24T22:36:01.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.4",
            provider: "openai-codex",
            usage: { input: 10, output: 5, totalTokens: 15 },
          },
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-24T22:36:02.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.4",
            provider: "cliproxyapi",
            usage: { input: 10, output: 5, totalTokens: 15 },
          },
        }),
      ].join("\n"),
    );

    expect(session?.modelTokens["gpt-5.4"]?.provider).toBeUndefined();
  });

  it("classifies pi subagent extension session paths as subagent originators", () => {
    const session = parsePiSessionText(
      [
        JSON.stringify({
          type: "session",
          id: "pi-path-subagent",
          timestamp: "2026-07-02T13:55:11.507Z",
          cwd: "/repo",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-07-02T13:55:12.000Z",
          message: {
            role: "assistant",
            model: "gpt-5.4",
            usage: { input: 10, output: 5, totalTokens: 15 },
          },
        }),
      ].join("\n"),
      "/home/me/.pi/agent/sessions/--repo--/2026-07-02T13-51-21-377Z_parent/7c6b9b8e/run-0/session.jsonl",
    );

    expect(session).toMatchObject({
      originator: "subagent",
    });
  });
});

function sumRequestTotals(session: ReturnType<typeof parsePiSessionText>): number {
  return (session?.requests ?? []).reduce((sum, request) => sum + request.total, 0);
}
