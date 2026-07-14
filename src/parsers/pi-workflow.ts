import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { ParsedSession, TokenUsage } from "../domain.js";
import { addRequest, sessionLabel } from "../ingest-shared.js";
import { asNumber, asString, isRecord } from "./shared.js";

const ORIGINATOR = "pi-dynamic-workflows";

type WorkflowAgent = {
  label: string;
  model?: string;
  tokens: number;
};

export async function parsePiWorkflowFile(path: string): Promise<ParsedSession | undefined> {
  try {
    return parsePiWorkflowText(await readFile(path, "utf8"), path);
  } catch {
    return undefined;
  }
}

export function parsePiWorkflowText(
  content: string,
  path = "/tmp/project-000000000000/runs/run.json",
): ParsedSession | undefined {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.status !== "completed") return undefined;

  const runId = asString(value.runId);
  const workflowName = asString(value.workflowName);
  const start = validDate(value.startedAt);
  const end = validDate(value.completedAt);
  const rawUsage = isRecord(value.tokenUsage) ? value.tokenUsage : undefined;
  const tokens = rawUsage ? parseRequiredTokens(rawUsage) : undefined;
  if (!runId || !workflowName || !start || !end || end < start || !tokens) return undefined;

  const agents = parseAgents(value.agents);
  if (!agents || agents.reduce((sum, agent) => sum + agent.tokens, 0) !== tokens.total) {
    return undefined;
  }

  const repo = workflowRepo(path);
  const requests: ParsedSession["requests"] = [];
  const model = uniqueUsageModel(agents);
  if (tokens.total > 0) {
    addRequest(requests, {
      model,
      originator: ORIGINATOR,
      repo,
      sessionId: runId,
      source: "pi",
      tokens,
      ts: end,
    });
  }
  const activeSeconds = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  const modelKey = model ?? "unknown";
  const modelTokens = tokens.total
    ? { [modelKey]: { ...tokens, billableOutput: tokens.output } }
    : {};
  const day = end.toISOString().slice(0, 10);

  return {
    activeSeconds,
    assistantTurns: requests.length,
    cacheWriteKnown: true,
    dayModelActiveSeconds: { [day]: { [modelKey]: activeSeconds } },
    dayStateActiveSeconds: { [day]: { [`${modelKey}::unknown`]: activeSeconds } },
    efforts: {},
    end,
    languages: {},
    modelActiveSeconds: { [modelKey]: activeSeconds },
    modelTokens,
    models: tokens.total ? { [modelKey]: 1 } : {},
    originator: ORIGINATOR,
    path,
    repo,
    requestCount: requests.length,
    requests,
    sessionId: runId,
    source: "pi",
    sourceLabel: sessionLabel("pi", ORIGINATOR),
    start,
    stateActiveSeconds: { [`${modelKey}::unknown`]: activeSeconds },
    tokens,
    userTurns: 0,
    workflowRunId: runId,
  };
}

export function removePersistedWorkflowUsage(
  workflow: ParsedSession,
  persisted: ParsedSession[],
): ParsedSession | undefined {
  const matches = persisted.filter((session) => session.workflowRunId === workflow.workflowRunId);
  if (matches.length === 0) return workflow;
  const remainder = subtractTokens(
    workflow.tokens,
    matches.map((session) => session.tokens),
  );
  if (!remainder || remainder.total === 0) return undefined;

  const request = { ...workflow.requests[0] };
  if (!request) return undefined;
  Object.assign(request, requestTokens(remainder));
  const activeSeconds = Math.max(
    0,
    workflow.activeSeconds - matches.reduce((sum, session) => sum + session.activeSeconds, 0),
  );
  const day = workflow.end.toISOString().slice(0, 10);
  return {
    ...workflow,
    activeSeconds,
    assistantTurns: 1,
    dayModelActiveSeconds: { [day]: { unknown: activeSeconds } },
    dayStateActiveSeconds: { [day]: { "unknown::unknown": activeSeconds } },
    modelActiveSeconds: { unknown: activeSeconds },
    modelTokens: { unknown: { ...remainder, billableOutput: remainder.output } },
    models: { unknown: 1 },
    requestCount: 1,
    requests: [request],
    stateActiveSeconds: { "unknown::unknown": activeSeconds },
    tokens: remainder,
  };
}

function parseRequiredTokens(value: Record<string, unknown>): TokenUsage | undefined {
  const keys = ["input", "output", "total", "cacheRead", "cacheWrite"] as const;
  if (keys.some((key) => !isNonnegativeFinite(value[key]))) return undefined;
  return {
    cacheWrite: asNumber(value.cacheWrite),
    cached: asNumber(value.cacheRead),
    input: asNumber(value.input),
    output: asNumber(value.output),
    reasoning: 0,
    total: asNumber(value.total),
  };
}

function parseAgents(value: unknown): WorkflowAgent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const agents: WorkflowAgent[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const label = asString(item.label);
    if (!label || !isNonnegativeFinite(item.tokens)) return undefined;
    const tokens = asNumber(item.tokens);
    const status = asString(item.status);
    if (tokens > 0 && status !== "done") return undefined;
    agents.push({ label, model: asString(item.model), tokens });
  }
  return agents;
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isNonnegativeFinite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function uniqueUsageModel(agents: WorkflowAgent[]): string | undefined {
  const models = new Set(agents.filter((agent) => agent.tokens > 0).map((agent) => agent.model));
  return models.size === 1 ? [...models][0] : undefined;
}

function workflowRepo(path: string): string {
  const project = basename(dirname(dirname(path)));
  return project.replace(/-[a-f0-9]{12}$/i, "") || "unknown";
}

function subtractTokens(total: TokenUsage, parts: TokenUsage[]): TokenUsage | undefined {
  const persisted = parts.reduce(
    (sum, part) => ({
      cacheWrite: sum.cacheWrite + part.cacheWrite,
      cached: sum.cached + part.cached,
      input: sum.input + part.input,
      output: sum.output + part.output,
      reasoning: sum.reasoning + part.reasoning,
      total: sum.total + part.total,
    }),
    zeroTokenUsage(),
  );
  if (persisted.total >= total.total) return undefined;
  return {
    cacheWrite: Math.max(0, total.cacheWrite - persisted.cacheWrite),
    cached: Math.max(0, total.cached - persisted.cached),
    input: Math.max(0, total.input - persisted.input),
    output: Math.max(0, total.output - persisted.output),
    reasoning: 0,
    total: total.total - persisted.total,
  };
}

function zeroTokenUsage(): TokenUsage {
  return { cacheWrite: 0, cached: 0, input: 0, output: 0, reasoning: 0, total: 0 };
}

function requestTokens(tokens: TokenUsage) {
  const contextSize = tokens.input + tokens.cached + tokens.cacheWrite;
  return {
    cacheRead: tokens.cached,
    cacheReadRatio: contextSize ? tokens.cached / contextSize : 0,
    cacheWrite: tokens.cacheWrite,
    contextSize,
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    total: tokens.total,
    uncachedInput: tokens.input + tokens.cacheWrite,
  };
}
