import type { ParsedSession } from "../domain.js";
import { inferLanguages, mergeCounts, repoName } from "../ingest-shared.js";
import {
  allocateStateTime,
  collapseDayStateSeconds,
  collapseStateSeconds,
  parseTimestamp,
} from "../report-core.js";

type EventMark = { effort?: string; model?: string; ts: Date };

type TimingState = {
  currentEffort?: string;
  currentModel?: string;
  eventMarks: EventMark[];
  events: Date[];
};

export type ParserBaseState = TimingState & {
  assistantTurns: number;
  cwd?: string;
  languages: Record<string, number>;
  models: Record<string, number>;
  path: string;
  requests: ParsedSession["requests"];
  sessionId?: string;
  tokens: ParsedSession["tokens"];
  userTurns: number;
};

export type ModelTokenParserState = ParserBaseState & {
  modelTokens: ParsedSession["modelTokens"];
};

export function parseSessionText<TState>(
  content: string,
  path: string,
  createState: (path: string) => TState,
  parseLine: (rawLine: string, state: TState) => void,
  finish: (state: TState) => ParsedSession | undefined,
): ParsedSession | undefined {
  const state = createState(path);
  for (const rawLine of content.split("\n")) {
    parseLine(rawLine, state);
  }
  return finish(state);
}

export function prepareJsonLine<TState extends TimingState & { languages: Record<string, number> }>(
  rawLine: string,
  state: TState,
): { item: Record<string, unknown>; ts: Date | undefined } | undefined {
  const line = rawLine.trim();
  if (!line) {
    return undefined;
  }

  mergeCounts(state.languages, inferLanguages(line));
  const item = parseJsonObject(line);
  if (!item) {
    return undefined;
  }

  return { item, ts: readTimestamp(item, state) };
}

function readTimestamp<TState extends TimingState>(
  item: Record<string, unknown>,
  state: TState,
): Date | undefined {
  const ts = typeof item.timestamp === "string" ? parseTimestamp(item.timestamp) : undefined;
  if (ts) {
    state.events.push(ts);
    addEventMark(ts, state);
  }
  return ts;
}

function addEventMark<TState extends TimingState>(ts: Date, state: TState): void {
  state.eventMarks.push({ effort: state.currentEffort, model: state.currentModel, ts });
}

export function countRole<TState extends { assistantTurns: number; userTurns: number }>(
  role: string | undefined,
  state: TState,
): void {
  if (role === "user") {
    state.userTurns += 1;
  }
  if (role === "assistant") {
    state.assistantTurns += 1;
  }
}

export function setCurrentModel<TState extends TimingState & { models: Record<string, number> }>(
  model: string | undefined,
  ts: Date | undefined,
  state: TState,
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

export function setCurrentEffort<TState extends TimingState & { efforts: Record<string, number> }>(
  effort: string | undefined,
  ts: Date | undefined,
  state: TState,
): void {
  if (!effort) {
    return;
  }
  state.efforts[effort] = (state.efforts[effort] ?? 0) + 1;
  state.currentEffort = effort;
  if (ts) {
    addEventMark(ts, state);
  }
}

export function addTokens(target: ParsedSession["tokens"], value: ParsedSession["tokens"]): void {
  target.input += value.input;
  target.cached += value.cached;
  target.cacheWrite += value.cacheWrite;
  target.output += value.output;
  target.reasoning += value.reasoning;
  target.total += value.total;
}

export function addModelTokens(
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

export function buildParsedSession(
  state: ParserBaseState,
  extras: Pick<
    ParsedSession,
    "cacheWriteKnown" | "efforts" | "modelTokens" | "source" | "sourceLabel"
  > &
    Partial<Pick<ParsedSession, "originator">>,
): ParsedSession | undefined {
  if (state.events.length === 0) {
    return undefined;
  }

  state.events.sort((a, b) => a.getTime() - b.getTime());
  const allocated = allocateStateTime(state.eventMarks);

  return {
    activeSeconds: allocated.totalSeconds,
    assistantTurns: state.assistantTurns,
    cacheWriteKnown: extras.cacheWriteKnown,
    cwd: state.cwd,
    dayModelActiveSeconds: collapseDayStateSeconds(allocated.byDayStateSeconds),
    dayStateActiveSeconds: allocated.byDayStateSeconds,
    end: state.events.at(-1) ?? state.events[0],
    efforts: extras.efforts,
    languages: state.languages,
    modelActiveSeconds: collapseStateSeconds(allocated.byStateSeconds),
    modelTokens: extras.modelTokens,
    models: state.models,
    originator: extras.originator,
    path: state.path,
    repo: repoName(state.cwd),
    requestCount: state.requests.length,
    requests: state.requests,
    sessionId: finalSessionId(state.sessionId, state.path),
    source: extras.source,
    sourceLabel: extras.sourceLabel,
    start: state.events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: { ...state.tokens },
    userTurns: state.userTurns,
  };
}

export function finalSessionId(sessionId: string | undefined, path: string): string {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function modelTokenBucket(): ParsedSession["modelTokens"][string] {
  return {
    billableOutput: 0,
    cacheWrite: 0,
    cached: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  };
}
