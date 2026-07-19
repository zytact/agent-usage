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

  it("deduplicates streamed assistant records and preserves reasoning effort", () => {
    const base = {
      cwd: "/tmp/demo",
      effort: "high",
      sessionId: "codex-backed-claude",
      type: "assistant",
    };
    const message = {
      id: "resp-1",
      model: "gpt-5.6-sol",
      role: "assistant",
    };
    const session = parseClaudeSessionText(
      [
        JSON.stringify({
          cwd: "/tmp/demo",
          sessionId: "codex-backed-claude",
          timestamp: "2026-07-18T10:00:00.000Z",
          type: "user",
        }),
        JSON.stringify({
          ...base,
          message: { ...message, usage: { input_tokens: 0, output_tokens: 0 } },
          timestamp: "2026-07-18T10:00:00.000Z",
        }),
        JSON.stringify({
          ...base,
          message: {
            ...message,
            usage: {
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 80,
              input_tokens: 20,
              output_tokens: 10,
            },
          },
          timestamp: "2026-07-18T10:00:01.000Z",
        }),
        JSON.stringify({
          ...base,
          message: {
            ...message,
            usage: {
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 80,
              input_tokens: 20,
              output_tokens: 10,
            },
          },
          timestamp: "2026-07-18T10:00:02.000Z",
        }),
      ].join("\n"),
      "codex-backed-claude.jsonl",
    );

    expect(session).toMatchObject({
      assistantTurns: 1,
      efforts: { high: 1 },
      models: { "gpt-5.6-sol": 1 },
      requestCount: 1,
      tokens: {
        cacheWrite: 0,
        cached: 80,
        input: 20,
        output: 10,
        reasoning: 0,
        total: 110,
      },
    });
    expect(session?.requests[0]).toMatchObject({
      effort: "high",
      model: "gpt-5.6-sol",
      total: 110,
    });
  });

  it("distinguishes explicit zero from unavailable telemetry", () => {
    const session = parseClaudeSessionText(
      [
        JSON.stringify({
          timestamp: "2026-07-18T10:00:00.000Z",
          type: "user",
        }),
        JSON.stringify({
          message: {
            model: "gpt-5.6-sol",
            usage: {
              cache_creation_input_tokens: 0,
              input_tokens: 5,
              output_tokens: 2,
            },
          },
          timestamp: "2026-07-18T10:00:01.000Z",
          type: "assistant",
        }),
        JSON.stringify({
          message: {
            model: "gpt-5.6-sol",
            usage: { input_tokens: 7, output_tokens: 3 },
          },
          timestamp: "2026-07-18T10:00:02.000Z",
          type: "assistant",
        }),
      ].join("\n"),
    );

    expect(session).toMatchObject({
      cacheWriteAvailability: "partial",
      reasoningAvailability: "unknown",
    });
    expect(session?.requests.map((request) => request.cacheWriteAvailability)).toEqual([
      "known",
      "unknown",
    ]);
    expect(session?.requests.map((request) => request.reasoningAvailability)).toEqual([
      "unknown",
      "unknown",
    ]);
  });

  it("separates explicit reasoning from output without double counting", () => {
    const session = parseClaudeSessionText(
      [
        JSON.stringify({ timestamp: "2026-07-18T10:00:00.000Z", type: "user" }),
        JSON.stringify({
          message: {
            id: "resp-reasoning",
            model: "gpt-5.6-sol",
            usage: {
              input_tokens: 10,
              output_tokens: 25,
              output_tokens_details: { reasoning_tokens: 5 },
              total_tokens: 35,
            },
          },
          timestamp: "2026-07-18T10:00:01.000Z",
          type: "assistant",
        }),
      ].join("\n"),
    );

    expect(session).toMatchObject({
      reasoningAvailability: "known",
      tokens: { input: 10, output: 20, reasoning: 5, total: 35 },
    });
    expect(session?.modelTokens["gpt-5.6-sol"]?.billableOutput).toBe(25);
  });

  it("adds separately reported reasoning to output totals", () => {
    const session = parseClaudeSessionText(
      [
        JSON.stringify({ timestamp: "2026-07-18T10:00:00.000Z", type: "user" }),
        JSON.stringify({
          message: {
            id: "resp-separate-reasoning",
            model: "gpt-5.6-sol",
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              reasoning_output_tokens: 5,
            },
          },
          timestamp: "2026-07-18T10:00:01.000Z",
          type: "assistant",
        }),
      ].join("\n"),
    );

    expect(session).toMatchObject({
      reasoningAvailability: "known",
      tokens: { input: 10, output: 20, reasoning: 5, total: 35 },
    });
    expect(session?.modelTokens["gpt-5.6-sol"]?.billableOutput).toBe(25);
  });

  it("prefers the streamed duplicate with more complete telemetry", () => {
    const session = parseClaudeSessionText(
      [
        JSON.stringify({ timestamp: "2026-07-18T10:00:00.000Z", type: "user" }),
        JSON.stringify({
          message: {
            id: "resp-complete",
            model: "gpt-5.6-sol",
            usage: { input_tokens: 10, output_tokens: 20 },
          },
          timestamp: "2026-07-18T10:00:01.000Z",
          type: "assistant",
        }),
        JSON.stringify({
          message: {
            id: "resp-complete",
            model: "gpt-5.6-sol",
            usage: {
              cache_creation_input_tokens: 0,
              input_tokens: 10,
              output_tokens: 20,
              output_tokens_details: { reasoning_tokens: 4 },
            },
          },
          timestamp: "2026-07-18T10:00:02.000Z",
          type: "assistant",
        }),
      ].join("\n"),
    );

    expect(session).toMatchObject({
      assistantTurns: 1,
      cacheWriteAvailability: "known",
      reasoningAvailability: "known",
      tokens: { cacheWrite: 0, output: 16, reasoning: 4 },
    });
  });

  it("counts assistant records without a message envelope", () => {
    const session = parseClaudeSessionText(
      [
        JSON.stringify({
          cwd: "/tmp/demo",
          sessionId: "partial-claude",
          timestamp: "2026-07-18T10:00:00.000Z",
          type: "assistant",
        }),
        JSON.stringify({
          cwd: "/tmp/demo",
          message: {
            model: "gpt-5.6-luna",
            usage: { input_tokens: 5, output_tokens: 2 },
          },
          sessionId: "partial-claude",
          timestamp: "2026-07-18T10:00:01.000Z",
          type: "assistant",
        }),
      ].join("\n"),
      "partial-claude.jsonl",
    );

    expect(session).toMatchObject({ assistantTurns: 2, requestCount: 1 });
  });

  it("infers claude originator from entrypoint", () => {
    const session = parseClaudeSessionText(
      [
        JSON.stringify({
          cwd: "/tmp/demo",
          entrypoint: "sdk-cli",
          sessionId: "claude-sdk-cli",
          timestamp: "2026-06-20T10:00:00.000Z",
          type: "user",
        }),
        JSON.stringify({
          entrypoint: "sdk-cli",
          message: {
            model: "claude-sonnet-4-6",
            role: "assistant",
            usage: {
              cache_creation_input_tokens: 3,
              cache_read_input_tokens: 2,
              input_tokens: 1,
              output_tokens: 4,
              total_tokens: 10,
            },
          },
          sessionId: "claude-sdk-cli",
          timestamp: "2026-06-20T10:00:10.000Z",
          type: "assistant",
        }),
      ].join("\n"),
      "claude-sdk-cli.jsonl",
    );

    expect(session).toMatchObject({
      cacheWriteAvailability: "known",
      originator: "sdk-cli",
      sourceLabel: "Claude Code",
    });
  });

  it("prefers subagent when claude sidechain flag is present", () => {
    const session = parseClaudeSessionText(
      [
        JSON.stringify({
          cwd: "/tmp/demo",
          isSidechain: true,
          sessionId: "claude-subagent",
          timestamp: "2026-06-20T10:00:00.000Z",
          type: "user",
        }),
        JSON.stringify({
          isSidechain: true,
          message: {
            model: "claude-sonnet-4-6",
            role: "assistant",
            usage: {
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              input_tokens: 1,
              output_tokens: 2,
              total_tokens: 3,
            },
          },
          sessionId: "claude-subagent",
          timestamp: "2026-06-20T10:00:10.000Z",
          type: "assistant",
        }),
      ].join("\n"),
      "claude-subagent.jsonl",
    );

    expect(session).toMatchObject({
      originator: "subagent",
      sourceLabel: "Claude Code",
    });
  });
});
