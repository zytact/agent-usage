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
      cacheWriteKnown: true,
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
