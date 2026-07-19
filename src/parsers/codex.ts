import { readFile } from "node:fs/promises";

import type { ParsedSession } from "../domain.js";
import { addRequest, repoName, sessionLabel, zeroTokens } from "../ingest-shared.js";
import {
  asNumber,
  asString,
  buildParsedSession,
  countRole,
  finalSessionId,
  isRecord,
  parseSessionText,
  prepareJsonLine,
  setCurrentEffort as setSharedCurrentEffort,
  setCurrentModel as setSharedCurrentModel,
} from "./shared.js";

export async function parseCodexSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parseCodexSessionText(content, path);
}

type CodexParseState = {
  assistantTurns: number;
  currentEffort?: string;
  currentModel?: string;
  cwd?: string;
  efforts: Record<string, number>;
  eventMarks: Array<{ effort?: string; model?: string; ts: Date }>;
  events: Date[];
  languages: Record<string, number>;
  models: Record<string, number>;
  originator?: string;
  path: string;
  requests: ParsedSession["requests"];
  sessionId?: string;
  tokens: ParsedSession["tokens"];
  userTurns: number;
};

export function parseCodexSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  return parseSessionText(content, path, createCodexState, parseCodexLine, finishCodexSession);
}

function createCodexState(path: string): CodexParseState {
  return {
    assistantTurns: 0,
    efforts: {},
    eventMarks: [],
    events: [],
    languages: {},
    models: {},
    path,
    requests: [],
    tokens: zeroTokens(),
    userTurns: 0,
  };
}

function parseCodexLine(rawLine: string, state: CodexParseState): void {
  const parsed = prepareJsonLine(rawLine, state);
  if (!parsed) {
    return;
  }

  const { item, ts } = parsed;
  const payload = isRecord(item.payload) ? item.payload : undefined;

  parseSessionMeta(item.type, payload, state);
  parseTurnContext(item.type, payload, ts, state);
  parseResponseItem(item.type, payload, state);
  parseTokenCount(item.type, payload, ts, state);
}

function parseSessionMeta(
  type: unknown,
  payload: Record<string, unknown> | undefined,
  state: CodexParseState,
): void {
  if (type !== "session_meta" || !payload) {
    return;
  }
  state.sessionId = asString(payload.id) ?? state.sessionId;
  state.cwd = asString(payload.cwd) ?? state.cwd;
  state.originator = inferCodexOriginator(payload) ?? state.originator;
}

function inferCodexOriginator(payload: Record<string, unknown>): string | undefined {
  if (isCodexSubagent(payload)) {
    return "subagent";
  }
  return asString(payload.originator);
}

function isCodexSubagent(payload: Record<string, unknown>): boolean {
  if (asString(payload.thread_source)?.toLowerCase() === "subagent") {
    return true;
  }
  if (asString(payload.parent_thread_id)) {
    return true;
  }
  const source = payload.source;
  if (isRecord(source) && source.subagent !== undefined) {
    return true;
  }
  return false;
}

function parseTurnContext(
  type: unknown,
  payload: Record<string, unknown> | undefined,
  ts: Date | undefined,
  state: CodexParseState,
): void {
  if (type !== "turn_context" || !payload) {
    return;
  }
  setCurrentModel(asString(payload.model), ts, state);
  setCurrentEffort(asString(payload.effort) ?? nestedReasoningEffort(payload), ts, state);
}

function parseResponseItem(
  type: unknown,
  payload: Record<string, unknown> | undefined,
  state: CodexParseState,
): void {
  if (type !== "response_item" || payload?.type !== "message") {
    return;
  }
  countRole(asString(payload.role), state);
}

function parseTokenCount(
  type: unknown,
  payload: Record<string, unknown> | undefined,
  ts: Date | undefined,
  state: CodexParseState,
): void {
  const usages = readTokenUsages(type, payload);
  if (!usages) {
    return;
  }

  state.tokens = codexTotalTokens(usages.totalUsage);
  addCodexRequest(codexRequestTokens(usages.lastUsage), ts, state);
}

function readTokenUsages(
  type: unknown,
  payload: Record<string, unknown> | undefined,
): { lastUsage: Record<string, unknown>; totalUsage: Record<string, unknown> } | undefined {
  if (!isTokenCountEvent(type, payload)) {
    return undefined;
  }
  return tokenUsagesFromInfo(readRecord(payload.info));
}

function isTokenCountEvent(
  type: unknown,
  payload: Record<string, unknown> | undefined,
): payload is Record<string, unknown> {
  return type === "event_msg" && payload?.type === "token_count";
}

function tokenUsagesFromInfo(
  info: Record<string, unknown> | undefined,
): { lastUsage: Record<string, unknown>; totalUsage: Record<string, unknown> } | undefined {
  const totalUsage = readRecord(info?.total_token_usage);
  const lastUsage = readRecord(info?.last_token_usage);
  if (!totalUsage) {
    return undefined;
  }
  if (!lastUsage) {
    return undefined;
  }
  return { lastUsage, totalUsage };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function addCodexRequest(
  tokens: ParsedSession["tokens"],
  ts: Date | undefined,
  state: CodexParseState,
): void {
  addRequest(state.requests, {
    effort: state.currentEffort,
    model: state.currentModel,
    originator: state.originator,
    repo: repoName(state.cwd),
    sessionId: finalSessionId(state.sessionId, state.path),
    source: "codex",
    telemetry: { cacheWrite: "unknown" },
    tokens,
    ts,
  });
}

function finishCodexSession(state: CodexParseState): ParsedSession | undefined {
  const modelTokens = distributeModelTokens(state.tokens, state.models);
  return buildParsedSession(state, {
    efforts: state.efforts,
    modelTokens,
    originator: state.originator,
    source: "codex",
    sourceLabel: sessionLabel("codex", state.originator),
  });
}

function setCurrentModel(
  model: string | undefined,
  ts: Date | undefined,
  state: CodexParseState,
): void {
  setSharedCurrentModel(model, ts, state);
}

function setCurrentEffort(
  effort: string | undefined,
  ts: Date | undefined,
  state: CodexParseState,
): void {
  setSharedCurrentEffort(effort, ts, state);
}

function codexTotalTokens(usage: Record<string, unknown>): ParsedSession["tokens"] {
  const rawInput = asNumber(usage.input_tokens);
  const cached = asNumber(usage.cached_input_tokens);
  const input = Math.max(rawInput - cached, 0);
  const output = asNumber(usage.output_tokens);
  return {
    cacheWrite: 0,
    cached,
    input,
    output,
    reasoning: asNumber(usage.reasoning_output_tokens),
    total: asNumber(usage.total_tokens) || input + cached + output,
  };
}

function codexRequestTokens(usage: Record<string, unknown>): ParsedSession["tokens"] {
  const rawInput = asNumber(usage.input_tokens);
  const cached = asNumber(usage.cached_input_tokens);
  return {
    cacheWrite: 0,
    cached,
    input: Math.max(rawInput - cached, 0),
    output: asNumber(usage.output_tokens),
    reasoning: asNumber(usage.reasoning_output_tokens),
    total: asNumber(usage.total_tokens),
  };
}

function distributeModelTokens(
  tokens: ParsedSession["tokens"],
  models: Record<string, number>,
): ParsedSession["modelTokens"] {
  const totalMarks = Object.values(models).reduce((sum, value) => sum + value, 0);
  if (totalMarks === 0) {
    return {};
  }

  const modelTokens: ParsedSession["modelTokens"] = {};
  for (const [model, marks] of Object.entries(models)) {
    const ratio = marks / totalMarks;
    const output = Math.trunc(tokens.output * ratio);
    modelTokens[model] = {
      billableOutput: output,
      cacheWrite: Math.trunc(tokens.cacheWrite * ratio),
      cached: Math.trunc(tokens.cached * ratio),
      input: Math.trunc(tokens.input * ratio),
      output,
      reasoning: Math.trunc(tokens.reasoning * ratio),
      total: Math.trunc(tokens.total * ratio),
    };
  }
  return modelTokens;
}

function nestedReasoningEffort(payload: Record<string, unknown>): string | undefined {
  const collaborationMode = isRecord(payload.collaboration_mode)
    ? payload.collaboration_mode
    : undefined;
  const settings = isRecord(collaborationMode?.settings) ? collaborationMode.settings : undefined;
  return asString(settings?.reasoning_effort);
}
