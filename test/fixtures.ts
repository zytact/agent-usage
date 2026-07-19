import { rm } from "node:fs/promises";

import { afterEach } from "vite-plus/test";

import type { ParsedSession, SessionRequest } from "../src/domain.js";

type RequestInput = Partial<SessionRequest> & Pick<SessionRequest, "model">;

const defaultDate = new Date("2026-06-14T10:00:00Z");
const defaultEnd = new Date("2026-06-14T10:30:00Z");

export function useTempDirs(): string[] {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  return tempDirs;
}

export function makeRequest(overrides: RequestInput): SessionRequest {
  return {
    ...defaultRequest(overrides.model),
    ...overrides,
    ts: overrides.ts ?? defaultDate,
    uncachedInput: overrides.uncachedInput ?? overrides.input ?? 0,
  };
}

function defaultRequest(model: string): SessionRequest {
  return {
    cacheRead: 0,
    cacheReadRatio: 0,
    cacheWrite: 0,
    cacheWriteAvailability: "known",
    contextSize: 0,
    date: "2026-06-14",
    effort: "medium",
    input: 0,
    model,
    output: 0,
    reasoning: 0,
    reasoningAvailability: "known",
    repo: "agent-usage",
    sessionId: "session-1",
    source: "codex",
    sourceLabel: "Codex",
    subharness: "codex-cli",
    total: 0,
    ts: defaultDate,
    uncachedInput: 0,
  };
}

export function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  const requests = overrides.requests ?? [];
  const modelTokens = overrides.modelTokens ?? tokensByModel(requests);
  const models =
    overrides.models ?? Object.fromEntries(requests.map((request) => [request.model, 1]));
  const modelActiveSeconds = overrides.modelActiveSeconds ?? secondsByModel(modelTokens);
  const dayStateActiveSeconds = overrides.dayStateActiveSeconds ?? defaultDayStates(requests);

  return {
    ...defaultSession(requests),
    ...overrides,
    dayModelActiveSeconds: overrides.dayModelActiveSeconds ?? { "2026-06-14": modelActiveSeconds },
    dayStateActiveSeconds,
    efforts: overrides.efforts ?? effortsByRequest(requests),
    modelActiveSeconds,
    modelTokens,
    models,
    requests,
    stateActiveSeconds: overrides.stateActiveSeconds ?? defaultStates(requests),
    tokens: overrides.tokens ?? totalTokens(requests),
  };
}

function defaultSession(requests: SessionRequest[]): ParsedSession {
  return {
    activeSeconds: 600,
    assistantTurns: requests.length,
    cacheWriteAvailability: requests.some((request) => request.cacheWriteAvailability === "known")
      ? requests.every((request) => request.cacheWriteAvailability === "known")
        ? "known"
        : "partial"
      : "unknown",
    cwd: undefined,
    dayModelActiveSeconds: {},
    dayStateActiveSeconds: {},
    end: defaultEnd,
    efforts: {},
    languages: { TypeScript: 2 },
    modelActiveSeconds: {},
    modelTokens: {},
    models: {},
    originator: undefined,
    path: "/tmp/session.jsonl",
    reasoningAvailability: requests.some((request) => request.reasoningAvailability === "known")
      ? requests.every((request) => request.reasoningAvailability === "known")
        ? "known"
        : "partial"
      : "unknown",
    repo: "agent-usage",
    requestCount: requests.length,
    requests,
    sessionId: "session-1",
    source: "codex",
    sourceLabel: "Codex",
    start: defaultDate,
    stateActiveSeconds: {},
    tokens: totalTokens(requests),
    userTurns: requests.length,
  };
}

function tokensByModel(requests: SessionRequest[]): ParsedSession["modelTokens"] {
  return Object.fromEntries(
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
}

function secondsByModel(modelTokens: ParsedSession["modelTokens"]): Record<string, number> {
  return Object.fromEntries(Object.keys(modelTokens).map((model) => [model, 600]));
}

function defaultDayStates(requests: SessionRequest[]): ParsedSession["dayStateActiveSeconds"] {
  return { "2026-06-14": defaultStates(requests) };
}

function defaultStates(requests: SessionRequest[]): Record<string, number> {
  return Object.fromEntries(
    requests.map((request) => [`${request.model}::${request.effort}`, 600]),
  );
}

function effortsByRequest(requests: SessionRequest[]): Record<string, number> {
  return Object.fromEntries(requests.map((request) => [request.effort, 1]));
}

function totalTokens(requests: SessionRequest[]): ParsedSession["tokens"] {
  return {
    cacheWrite: sumRequests(requests, "cacheWrite"),
    cached: sumRequests(requests, "cacheRead"),
    input: sumRequests(requests, "input"),
    output: sumRequests(requests, "output"),
    reasoning: sumRequests(requests, "reasoning"),
    total: sumRequests(requests, "total"),
  };
}

function sumRequests(requests: SessionRequest[], key: keyof SessionRequest): number {
  return requests.reduce((sum, request) => sum + Number(request[key] ?? 0), 0);
}
