import { readFile } from "node:fs/promises";

import type { ParsedSession } from "../domain.js";
import { addRequest, repoName, sessionLabel, zeroTokens } from "../ingest-shared.js";
import {
  addModelTokens,
  addTokens,
  asNumber,
  asString,
  buildParsedSession,
  countRole,
  finalSessionId,
  isRecord,
  type ModelTokenParserState,
  parseSessionText,
  prepareJsonLine,
  setCurrentModel as setSharedCurrentModel,
} from "./shared.js";

export async function parseClaudeSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parseClaudeSessionText(content, path);
}

type ClaudeParseState = ModelTokenParserState & {
  originator?: string;
};

export function parseClaudeSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  return parseSessionText(content, path, createClaudeState, parseClaudeLine, finishClaudeSession);
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
  const parsed = prepareJsonLine(rawLine, state);
  if (!parsed) {
    return;
  }

  const { item, ts } = parsed;
  state.sessionId = asString(item.sessionId) ?? state.sessionId;
  state.cwd = asString(item.cwd) ?? state.cwd;
  state.originator = inferOriginator(item, state.originator);
  countRole(asString(item.type), state);
  parseClaudeMessage(isRecord(item.message) ? item.message : undefined, ts, state);
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
  return buildParsedSession(state, {
    cacheWriteKnown: true,
    efforts: {},
    modelTokens: state.modelTokens,
    originator: state.originator,
    source: "claude",
    sourceLabel: sessionLabel("claude", state.originator),
  });
}

function setCurrentModel(
  model: string | undefined,
  ts: Date | undefined,
  state: ClaudeParseState,
): void {
  if (!isRealModel(model)) {
    return;
  }
  setSharedCurrentModel(model, ts, state);
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

function claudeUsageTokens(usage: Record<string, unknown>): ParsedSession["tokens"] {
  const input = asNumber(usage.input_tokens);
  const cached = asNumber(usage.cache_read_input_tokens);
  const cacheWrite = asNumber(usage.cache_creation_input_tokens);
  const output = asNumber(usage.output_tokens);
  return {
    cacheWrite,
    cached,
    input,
    output,
    reasoning: 0,
    total: asNumber(usage.total_tokens) || input + cached + cacheWrite + output,
  };
}

function inferOriginator(
  item: Record<string, unknown>,
  current: string | undefined,
): string | undefined {
  if (item.isSidechain === true) {
    return "subagent";
  }
  const entrypoint = asString(item.entrypoint);
  if (entrypoint) {
    return entrypoint;
  }
  return current;
}

function isRealModel(model: string | undefined): model is string {
  return Boolean(model && model !== "<synthetic>");
}
