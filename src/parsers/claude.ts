import { readFile } from "node:fs/promises";

import type { ParsedSession } from "../domain.js";
import {
  addRequest,
  inferLanguages,
  mergeCounts,
  repoName,
  sessionLabel,
  zeroTokens,
} from "../ingest-shared.js";
import {
  allocateStateTime,
  collapseDayStateSeconds,
  collapseStateSeconds,
  parseTimestamp,
} from "../report-core.js";

export async function parseClaudeSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parseClaudeSessionText(content, path);
}

type ClaudeParseState = {
  assistantTurns: number;
  currentModel?: string;
  cwd?: string;
  eventMarks: Array<{ effort?: string; model?: string; ts: Date }>;
  events: Date[];
  languages: Record<string, number>;
  modelTokens: ParsedSession["modelTokens"];
  models: Record<string, number>;
  path: string;
  requests: ParsedSession["requests"];
  sessionId?: string;
  tokens: ParsedSession["tokens"];
  userTurns: number;
};

export function parseClaudeSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  const state = createClaudeState(path);

  for (const rawLine of content.split("\n")) {
    parseClaudeLine(rawLine, state);
  }

  return finishClaudeSession(state);
}

function createClaudeState(path: string): ClaudeParseState {
  return {
    assistantTurns: 0,
    eventMarks: [],
    events: [],
    languages: {},
    modelTokens: {},
    models: {},
    path,
    requests: [],
    tokens: zeroTokens(),
    userTurns: 0,
  };
}

function parseClaudeLine(rawLine: string, state: ClaudeParseState): void {
  const line = rawLine.trim();
  if (!line) {
    return;
  }

  mergeCounts(state.languages, inferLanguages(line));
  const item = parseJsonObject(line);
  if (!item) {
    return;
  }

  const ts = readTimestamp(item, state);
  state.sessionId = asString(item.sessionId) ?? state.sessionId;
  state.cwd = asString(item.cwd) ?? state.cwd;
  countRole(asString(item.type), state);
  parseClaudeMessage(isRecord(item.message) ? item.message : undefined, ts, state);
}

function readTimestamp(item: Record<string, unknown>, state: ClaudeParseState): Date | undefined {
  const ts = typeof item.timestamp === "string" ? parseTimestamp(item.timestamp) : undefined;
  if (ts) {
    state.events.push(ts);
    addEventMark(ts, state);
  }
  return ts;
}

function parseClaudeMessage(
  envelope: Record<string, unknown> | undefined,
  ts: Date | undefined,
  state: ClaudeParseState,
): void {
  const model = asString(envelope?.model);
  setCurrentModel(model, ts, state);

  const usage = isRecord(envelope?.usage) ? envelope.usage : undefined;
  if (!usage) {
    return;
  }

  const usageTokens = claudeUsageTokens(usage);
  addTokens(state.tokens, usageTokens);
  if (isRealModel(model)) {
    addModelTokens(state.modelTokens, model, usageTokens);
    addClaudeRequest(model, usageTokens, ts, state);
  }
}

function finishClaudeSession(state: ClaudeParseState): ParsedSession | undefined {
  if (state.events.length === 0) {
    return undefined;
  }

  state.events.sort((a, b) => a.getTime() - b.getTime());
  const allocated = allocateStateTime(state.eventMarks);

  return {
    activeSeconds: allocated.totalSeconds,
    assistantTurns: state.assistantTurns,
    cwd: state.cwd,
    dayModelActiveSeconds: collapseDayStateSeconds(allocated.byDayStateSeconds),
    dayStateActiveSeconds: allocated.byDayStateSeconds,
    end: state.events.at(-1) ?? state.events[0],
    efforts: {},
    languages: state.languages,
    modelActiveSeconds: collapseStateSeconds(allocated.byStateSeconds),
    modelTokens: state.modelTokens,
    models: state.models,
    path: state.path,
    repo: repoName(state.cwd),
    requestCount: state.requests.length,
    requests: state.requests,
    sessionId: finalSessionId(state.sessionId, state.path),
    source: "claude",
    sourceLabel: sessionLabel("claude", undefined),
    start: state.events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: { ...state.tokens },
    userTurns: state.userTurns,
  };
}

function setCurrentModel(
  model: string | undefined,
  ts: Date | undefined,
  state: ClaudeParseState,
): void {
  if (!isRealModel(model)) {
    return;
  }
  state.models[model] = (state.models[model] ?? 0) + 1;
  state.currentModel = model;
  if (ts) {
    addEventMark(ts, state);
  }
}

function addClaudeRequest(
  model: string,
  tokens: ParsedSession["tokens"],
  ts: Date | undefined,
  state: ClaudeParseState,
): void {
  addRequest(state.requests, {
    model,
    repo: repoName(state.cwd),
    sessionId: finalSessionId(state.sessionId, state.path),
    source: "claude",
    tokens,
    ts,
  });
}

function countRole(role: string | undefined, state: ClaudeParseState): void {
  if (role === "user") {
    state.userTurns += 1;
  }
  if (role === "assistant") {
    state.assistantTurns += 1;
  }
}

function addEventMark(ts: Date, state: ClaudeParseState): void {
  state.eventMarks.push({ model: state.currentModel, ts });
}

function claudeUsageTokens(usage: Record<string, unknown>): ParsedSession["tokens"] {
  const input = asNumber(usage.input_tokens);
  const cached = asNumber(usage.cache_read_input_tokens);
  const cacheWrite = asNumber(usage.cache_creation_input_tokens);
  const output = asNumber(usage.output_tokens);
  const reasoning = sumIterationOutput(usage.iterations);
  return {
    cacheWrite,
    cached,
    input,
    output,
    reasoning,
    total: asNumber(usage.total_tokens) || input + cached + cacheWrite + output + reasoning,
  };
}

function sumIterationOutput(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }

  let total = 0;
  for (const item of value) {
    if (isRecord(item)) {
      total += asNumber(item.output_tokens);
    }
  }
  return total;
}

function addTokens(target: ParsedSession["tokens"], value: ParsedSession["tokens"]): void {
  target.input += value.input;
  target.cached += value.cached;
  target.cacheWrite += value.cacheWrite;
  target.output += value.output;
  target.reasoning += value.reasoning;
  target.total += value.total;
}

function addModelTokens(
  modelTokens: ParsedSession["modelTokens"],
  model: string,
  value: ParsedSession["tokens"],
): void {
  const bucket = (modelTokens[model] ??= modelTokenBucket());
  addTokens(bucket, value);
  bucket.billableOutput += value.output + value.reasoning;
}

function modelTokenBucket(): ParsedSession["modelTokens"][string] {
  return { ...zeroTokens(), billableOutput: 0 };
}

function isRealModel(model: string | undefined): model is string {
  return Boolean(model && model !== "<synthetic>");
}

function finalSessionId(sessionId: string | undefined, path: string): string {
  return (
    sessionId ??
    path
      .split("/")
      .pop()
      ?.replace(/\.jsonl$/, "") ??
    "unknown"
  );
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const item: unknown = JSON.parse(line);
    return isRecord(item) ? item : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
