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

type WorkflowUsageState = {
  effort: string;
  model: string;
};

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

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
  const usageState = aggregateUsageState(agents);
  if (tokens.total > 0) {
    addRequest(requests, {
      effort: usageState.effort,
      model: usageState.model,
      originator: ORIGINATOR,
      repo,
      sessionId: runId,
      source: "pi",
      tokens,
      ts: end,
    });
  }
  const activeSeconds = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  const modelTokens = tokens.total
    ? { [usageState.model]: { ...tokens, billableOutput: tokens.output } }
    : {};
  const day = end.toISOString().slice(0, 10);
  const state = `${usageState.model}::${usageState.effort}`;

  return {
    activeSeconds,
    assistantTurns: requests.length,
    cacheWriteKnown: true,
    dayModelActiveSeconds: { [day]: { [usageState.model]: activeSeconds } },
    dayStateActiveSeconds: { [day]: { [state]: activeSeconds } },
    efforts: tokens.total ? { [usageState.effort]: 1 } : {},
    end,
    languages: {},
    modelActiveSeconds: { [usageState.model]: activeSeconds },
    modelTokens,
    models: tokens.total ? { [usageState.model]: 1 } : {},
    originator: ORIGINATOR,
    path,
    repo,
    requestCount: requests.length,
    requests,
    sessionId: runId,
    source: "pi",
    sourceLabel: sessionLabel("pi", ORIGINATOR),
    start,
    stateActiveSeconds: { [state]: activeSeconds },
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
  const state = `${request.model}::${request.effort}`;
  return {
    ...workflow,
    activeSeconds,
    assistantTurns: 1,
    dayModelActiveSeconds: { [day]: { [request.model]: activeSeconds } },
    dayStateActiveSeconds: { [day]: { [state]: activeSeconds } },
    efforts: { [request.effort]: 1 },
    modelActiveSeconds: { [request.model]: activeSeconds },
    modelTokens: { [request.model]: { ...remainder, billableOutput: remainder.output } },
    models: { [request.model]: 1 },
    requestCount: 1,
    requests: [request],
    stateActiveSeconds: { [state]: activeSeconds },
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

function aggregateUsageState(agents: WorkflowAgent[]): WorkflowUsageState {
  const states = agents
    .filter((agent) => agent.tokens > 0)
    .map((agent) => parseModelSpec(agent.model));
  return {
    effort: uniqueValue(states.map((state) => state.effort)) ?? "mixed",
    model: uniqueValue(states.map((state) => state.model)) ?? "mixed",
  };
}

function parseModelSpec(spec: string | undefined): WorkflowUsageState {
  if (!spec) return { effort: "unknown", model: "unknown" };

  const separator = spec.lastIndexOf(":");
  const suffix = separator >= 0 ? spec.slice(separator + 1).toLowerCase() : undefined;
  const effort = suffix && THINKING_LEVELS.has(suffix) ? suffix : "unknown";
  const modelSpec = effort === "unknown" ? spec : spec.slice(0, separator);
  const providerSeparator = modelSpec.indexOf("/");
  const model = providerSeparator >= 0 ? modelSpec.slice(providerSeparator + 1) : modelSpec;
  return { effort, model: model || "unknown" };
}

function uniqueValue(values: string[]): string | undefined {
  const unique = new Set(values);
  return unique.size === 1 ? [...unique][0] : undefined;
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
