import { describe, expect, it } from "vite-plus/test";

import { parsePiWorkflowText, removePersistedWorkflowUsage } from "../src/parsers/pi-workflow.js";
import { parsePiSessionText } from "../src/parsers/pi.js";

const completed = {
  runId: "audit-abc123",
  workflowName: "audit",
  status: "completed",
  startedAt: "2026-06-14T10:00:00.000Z",
  completedAt: "2026-06-14T10:02:00.000Z",
  tokenUsage: { input: 100, output: 20, total: 170, cost: 0.1, cacheRead: 50, cacheWrite: 0 },
  agents: [
    {
      id: 1,
      label: "one",
      status: "done",
      model: "openai-codex/gpt-5.6-terra:medium",
      tokens: 100,
      startedAt: "2026-06-14T10:00:00.000Z",
      endedAt: "2026-06-14T10:01:00.000Z",
    },
    {
      id: 2,
      label: "two",
      status: "done",
      model: "openai-codex/gpt-5.6-terra:medium",
      tokens: 70,
      startedAt: "2026-06-14T10:01:00.000Z",
      endedAt: "2026-06-14T10:02:00.000Z",
    },
  ],
};

const path = "/home/me/.pi/workflows/projects/agent-usage-cdf7f1d83415/runs/audit.json";

describe("pi-dynamic-workflows parsing", () => {
  it("parses a completed in-memory workflow as one aggregate Session", () => {
    const session = parsePiWorkflowText(JSON.stringify(completed), path);

    expect(session).toMatchObject({
      originator: "pi-dynamic-workflows",
      repo: "agent-usage",
      requestCount: 1,
      reasoningAvailability: "unknown",
      sessionId: "audit-abc123",
      source: "pi",
      tokens: { cacheWrite: 0, cached: 50, input: 100, output: 20, reasoning: 0, total: 170 },
      workflowRunId: "audit-abc123",
    });
    expect(session?.requests[0]).toMatchObject({
      effort: "medium",
      model: "gpt-5.6-terra",
      reasoningAvailability: "unknown",
    });
    expect(session?.efforts).toEqual({ medium: 2 });
    expect(session?.models).toEqual({ "gpt-5.6-terra": 2 });
    expect(session?.stateActiveSeconds).toEqual({ "gpt-5.6-terra::medium": 120 });
  });

  it("labels heterogeneous agent models and efforts as mixed instead of unknown", () => {
    const session = parsePiWorkflowText(
      JSON.stringify({
        ...completed,
        agents: [
          { ...completed.agents[0], model: "openai-codex/gpt-5.6-sol:low" },
          { ...completed.agents[1], model: "opencode/deepseek-v4-flash-free" },
        ],
      }),
      path,
    );

    expect(session?.requests[0]).toMatchObject({ effort: "mixed", model: "mixed usage" });
    expect(session?.stateActiveSeconds).toEqual({ "mixed usage::mixed": 120 });
    expect(session?.workflowAgentUsage).toEqual([
      { effort: "low", label: "one", model: "gpt-5.6-sol", total: 100 },
      { effort: "unknown", label: "two", model: "deepseek-v4-flash-free", total: 70 },
    ]);
    expect(session?.models).toEqual({
      "deepseek-v4-flash-free": 1,
      "gpt-5.6-sol": 1,
    });
  });

  it("preserves non-effort model suffixes", () => {
    const session = parsePiWorkflowText(
      JSON.stringify({
        ...completed,
        agents: completed.agents.map((agent) => ({
          ...agent,
          model: "openrouter/deepseek/deepseek-chat:free",
        })),
      }),
      path,
    );

    expect(session?.requests[0]).toMatchObject({
      effort: "unknown",
      model: "deepseek/deepseek-chat:free",
    });
  });

  it.each(["running", "paused", "failed"])("skips %s records", (status) => {
    expect(parsePiWorkflowText(JSON.stringify({ ...completed, status }), path)).toBeUndefined();
  });

  it("skips malformed, partial, inconsistent, and unsupported agent records", () => {
    expect(parsePiWorkflowText("{", path)).toBeUndefined();
    expect(
      parsePiWorkflowText(JSON.stringify({ ...completed, completedAt: undefined }), path),
    ).toBeUndefined();
    expect(
      parsePiWorkflowText(
        JSON.stringify({ ...completed, tokenUsage: { ...completed.tokenUsage, total: 999 } }),
        path,
      ),
    ).toBeUndefined();
    expect(
      parsePiWorkflowText(
        JSON.stringify({ ...completed, agents: [{ ...completed.agents[0], status: "error" }] }),
        path,
      ),
    ).toBeUndefined();
  });

  it("removes an all-persisted run by durable workflow metadata", () => {
    const workflow = parsePiWorkflowText(JSON.stringify(completed), path)!;
    const persisted = persistedSession("one", {
      input: 100,
      cacheRead: 50,
      output: 20,
      totalTokens: 170,
    });

    expect(removePersistedWorkflowUsage(workflow, [persisted!])).toBeUndefined();
  });

  it("keeps only aggregate accounting not represented by mixed persisted Sessions", () => {
    const workflow = parsePiWorkflowText(JSON.stringify(completed), path)!;
    const persisted = persistedSession("one", {
      input: 60,
      cacheRead: 20,
      output: 10,
      totalTokens: 90,
    })!;
    const remainder = removePersistedWorkflowUsage(workflow, [persisted]);

    expect(remainder?.tokens).toEqual({
      cacheWrite: 0,
      cached: 30,
      input: 40,
      output: 10,
      reasoning: 0,
      total: 80,
    });
    expect(remainder?.requestCount).toBe(1);
    expect(remainder?.requests[0]).toMatchObject({ effort: "medium", model: "gpt-5.6-terra" });
    expect(remainder?.stateActiveSeconds).toEqual({ "gpt-5.6-terra::medium": 60 });
    expect(remainder?.workflowAgentUsage).toEqual([
      { effort: "medium", label: "two", model: "gpt-5.6-terra", total: 70 },
    ]);
  });
});

function persistedSession(label: string, usage: Record<string, number>) {
  return parsePiSessionText(
    [
      JSON.stringify({ type: "session", id: `persisted-${label}`, cwd: "/repo" }),
      JSON.stringify({ type: "session_info", name: `workflow:audit-abc123 ${label}` }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-06-14T10:01:00.000Z",
        message: { role: "assistant", model: "provider/model", usage },
      }),
    ].join("\n"),
  );
}
