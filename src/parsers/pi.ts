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

export async function parsePiSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parsePiSessionText(content, path);
}

type PiParseState = ModelTokenParserState & {
  effortMarks: Record<string, number>;
  originator?: string;
};

export function parsePiSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  return parseSessionText(content, path, createPiState, parsePiLine, finishPiSession);
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
  const parsed = prepareJsonLine(rawLine, state);
  if (!parsed) {
    return;
  }

  const { item, ts } = parsed;
  if (item.type === "session") {
    state.sessionId = asString(item.id) ?? state.sessionId;
    state.cwd = asString(item.cwd) ?? state.cwd;
    state.originator = inferPiOriginator(item, state.path) ?? state.originator;
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
      originator: state.originator,
      repo: repoName(state.cwd),
      sessionId: finalSessionId(state.sessionId, state.path),
      source: "pi",
      tokens: usageTokens,
      ts,
    });
  }
}

function finishPiSession(state: PiParseState): ParsedSession | undefined {
  return buildParsedSession(state, {
    cacheWriteKnown: true,
    efforts: state.effortMarks,
    modelTokens: state.modelTokens,
    originator: state.originator,
    source: "pi",
    sourceLabel: sessionLabel("pi", state.originator),
  });
}

function inferPiOriginator(item: Record<string, unknown>, path: string): string | undefined {
  const originator = asString(item.originator);
  const threadSource = asString(item.thread_source);
  if (
    isSubagentText(originator) ||
    isSubagentText(threadSource) ||
    asString(item.parentSession) ||
    isSubagentSessionPath(path)
  ) {
    return "subagent";
  }
  return originator ?? threadSource;
}

function isSubagentSessionPath(path: string): boolean {
  return /\/[a-f0-9]{8}\/run-\d+\/session\.jsonl$/i.test(path);
}

function isSubagentText(value: string | undefined): boolean {
  return value?.toLowerCase().includes("subagent") ?? false;
}

function setCurrentModel(
  model: string | undefined,
  ts: Date | undefined,
  state: PiParseState,
): void {
  setSharedCurrentModel(model, ts, state);
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
    state.eventMarks.push({ effort: state.currentEffort, model: state.currentModel, ts });
  }
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
