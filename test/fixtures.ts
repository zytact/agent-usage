import type { ParsedSession, SessionRequest } from "../src/domain.js";

type RequestInput = Partial<SessionRequest> & Pick<SessionRequest, "model">;

export function makeRequest(overrides: RequestInput): SessionRequest {
  const ts = overrides.ts ?? new Date("2026-06-14T10:00:00Z");
  return {
    cacheRead: overrides.cacheRead ?? 0,
    cacheReadRatio: overrides.cacheReadRatio ?? 0,
    cacheWrite: overrides.cacheWrite ?? 0,
    contextSize: overrides.contextSize ?? 0,
    date: overrides.date ?? "2026-06-14",
    effort: overrides.effort ?? "medium",
    input: overrides.input ?? 0,
    model: overrides.model,
    output: overrides.output ?? 0,
    reasoning: overrides.reasoning ?? 0,
    repo: overrides.repo ?? "agent-usage",
    sessionId: overrides.sessionId ?? "session-1",
    source: overrides.source ?? "codex",
    sourceLabel: overrides.sourceLabel ?? "Codex",
    subharness: overrides.subharness ?? "codex-cli",
    total: overrides.total ?? 0,
    ts,
    uncachedInput: overrides.uncachedInput ?? overrides.input ?? 0,
  };
}

export function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  const requests = overrides.requests ?? [];
  const modelTokens =
    overrides.modelTokens ??
    Object.fromEntries(
      requests.map((request) => [
        request.model,
        {
          billableOutput: request.output + request.reasoning,
          cacheWrite: request.cacheWrite,
          cached: request.cacheRead,
          input: request.input,
          output: request.output,
          reasoning: request.reasoning,
          total: request.total,
        },
      ]),
    );
  const models =
    overrides.models ?? Object.fromEntries(requests.map((request) => [request.model, 1]));
  const modelActiveSeconds =
    overrides.modelActiveSeconds ??
    Object.fromEntries(Object.keys(modelTokens).map((model) => [model, 600]));
  const dayStateActiveSeconds = overrides.dayStateActiveSeconds ?? {
    "2026-06-14": Object.fromEntries(
      requests.map((request) => [`${request.model}::${request.effort}`, 600]),
    ),
  };

  return {
    activeSeconds: overrides.activeSeconds ?? 600,
    assistantTurns: overrides.assistantTurns ?? requests.length,
    cwd: overrides.cwd,
    dayModelActiveSeconds: overrides.dayModelActiveSeconds ?? {
      "2026-06-14": modelActiveSeconds,
    },
    dayStateActiveSeconds,
    end: overrides.end ?? new Date("2026-06-14T10:30:00Z"),
    efforts:
      overrides.efforts ?? Object.fromEntries(requests.map((request) => [request.effort, 1])),
    languages: overrides.languages ?? { TypeScript: 2 },
    modelActiveSeconds,
    modelTokens,
    models,
    originator: overrides.originator,
    path: overrides.path ?? "/tmp/session.jsonl",
    repo: overrides.repo ?? "agent-usage",
    requestCount: overrides.requestCount ?? requests.length,
    requests,
    sessionId: overrides.sessionId ?? "session-1",
    source: overrides.source ?? "codex",
    sourceLabel: overrides.sourceLabel ?? "Codex",
    start: overrides.start ?? new Date("2026-06-14T10:00:00Z"),
    stateActiveSeconds:
      overrides.stateActiveSeconds ??
      Object.fromEntries(requests.map((request) => [`${request.model}::${request.effort}`, 600])),
    tokens: overrides.tokens ?? {
      cacheWrite: requests.reduce((sum, request) => sum + request.cacheWrite, 0),
      cached: requests.reduce((sum, request) => sum + request.cacheRead, 0),
      input: requests.reduce((sum, request) => sum + request.input, 0),
      output: requests.reduce((sum, request) => sum + request.output, 0),
      reasoning: requests.reduce((sum, request) => sum + request.reasoning, 0),
      total: requests.reduce((sum, request) => sum + request.total, 0),
    },
    userTurns: overrides.userTurns ?? requests.length,
  };
}
