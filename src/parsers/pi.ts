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

export async function parsePiSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parsePiSessionText(content, path);
}

type PiParseState = {
  assistantTurns: number;
  currentEffort?: string;
  currentModel?: string;
  cwd?: string;
  effortMarks: Record<string, number>;
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

export function parsePiSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  const state = createPiState(path);

  for (const rawLine of content.split("\n")) {
    parsePiLine(rawLine, state);
  }

  return finishPiSession(state);
}

function createPiState(path: string): PiParseState {
  return {
    assistantTurns: 0,
    effortMarks: {},
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

function parsePiLine(rawLine: string, state: PiParseState): void {
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
  if (item.type === "session") {
    state.sessionId = asString(item.id) ?? state.sessionId;
    state.cwd = asString(item.cwd) ?? state.cwd;
    return;
  }
  if (item.type === "model_change") {
    setCurrentModel(asString(item.modelId), ts, state);
    return;
  }
  if (item.type === "thinking_level_change") {
    setCurrentEffort(asString(item.thinkingLevel), ts, state);
    return;
  }
  if (item.type === "message") {
    parsePiMessage(item, ts, state);
  }
}

function readTimestamp(item: Record<string, unknown>, state: PiParseState): Date | undefined {
  const ts = typeof item.timestamp === "string" ? parseTimestamp(item.timestamp) : undefined;
  if (ts) {
    state.events.push(ts);
    addEventMark(ts, state);
  }
  return ts;
}

function parsePiMessage(
  item: Record<string, unknown>,
  ts: Date | undefined,
  state: PiParseState,
): void {
  const message = isRecord(item.message) ? item.message : undefined;
  const role = asString(message?.role);
  countRole(role, state);

  const model = asString(message?.model);
  setCurrentModel(model, ts, state);

  const usage = isRecord(message?.usage) ? message.usage : undefined;
  if (!usage) {
    return;
  }

  const usageTokens = piUsageTokens(usage);
  addTokens(state.tokens, usageTokens);
  const tokenModel = model ?? state.currentModel;
  addModelTokens(state.modelTokens, tokenModel, usageTokens);

  if (role === "assistant") {
    addRequest(state.requests, {
      effort: state.currentEffort,
      model: tokenModel,
      repo: repoName(state.cwd),
      sessionId: finalSessionId(state.sessionId, state.path),
      source: "pi",
      tokens: usageTokens,
      ts,
    });
  }
}

function finishPiSession(state: PiParseState): ParsedSession | undefined {
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
    efforts: state.effortMarks,
    languages: state.languages,
    modelActiveSeconds: collapseStateSeconds(allocated.byStateSeconds),
    modelTokens: state.modelTokens,
    models: state.models,
    path: state.path,
    repo: repoName(state.cwd),
    requestCount: state.requests.length,
    requests: state.requests,
    sessionId: finalSessionId(state.sessionId, state.path),
    source: "pi",
    sourceLabel: sessionLabel("pi", undefined),
    start: state.events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: { ...state.tokens },
    userTurns: state.userTurns,
  };
}

function setCurrentModel(
  model: string | undefined,
  ts: Date | undefined,
  state: PiParseState,
): void {
  if (!model) {
    return;
  }
  state.models[model] = (state.models[model] ?? 0) + 1;
  state.currentModel = model;
  if (ts) {
    addEventMark(ts, state);
  }
}

function setCurrentEffort(
  effort: string | undefined,
  ts: Date | undefined,
  state: PiParseState,
): void {
  if (!effort) {
    return;
  }
  state.effortMarks[effort] = (state.effortMarks[effort] ?? 0) + 1;
  state.currentEffort = effort;
  if (ts) {
    addEventMark(ts, state);
  }
}

function countRole(role: string | undefined, state: PiParseState): void {
  if (role === "user") {
    state.userTurns += 1;
  }
  if (role === "assistant") {
    state.assistantTurns += 1;
  }
}

function addEventMark(ts: Date, state: PiParseState): void {
  state.eventMarks.push({ effort: state.currentEffort, model: state.currentModel, ts });
}

function piUsageTokens(usage: Record<string, unknown>): ParsedSession["tokens"] {
  const input = asNumber(usage.input);
  const cached = asNumber(usage.cacheRead);
  const cacheWrite = asNumber(usage.cacheWrite);
  const output = asNumber(usage.output);
  return {
    cacheWrite,
    cached,
    input,
    output,
    reasoning: 0,
    total: asNumber(usage.totalTokens) || input + cached + cacheWrite + output,
  };
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
  model: string | undefined,
  value: ParsedSession["tokens"],
): void {
  if (!model) {
    return;
  }
  const bucket = (modelTokens[model] ??= modelTokenBucket());
  addTokens(bucket, value);
  bucket.billableOutput += value.output + value.reasoning;
}

function modelTokenBucket(): ParsedSession["modelTokens"][string] {
  return { ...zeroTokens(), billableOutput: 0 };
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
