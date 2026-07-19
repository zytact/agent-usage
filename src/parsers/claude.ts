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
  setCurrentEffort as setSharedCurrentEffort,
  setCurrentModel as setSharedCurrentModel,
} from "./shared.js";

export async function parseClaudeSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parseClaudeSessionText(content, path);
}

type ClaudeMessage = {
  effort?: string;
  envelope: Record<string, unknown>;
  ts?: Date;
};

type ClaudeParseState = ModelTokenParserState & {
  anonymousAssistantMessages: ClaudeMessage[];
  assistantMessages: Map<string, ClaudeMessage>;
  efforts: Record<string, number>;
  originator?: string;
  unparsedAssistantTurns: number;
};

export function parseClaudeSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  return parseSessionText(content, path, createClaudeState, parseClaudeLine, finishClaudeSession);
}

function createClaudeState(path: string): ClaudeParseState {
  return {
    anonymousAssistantMessages: [],
    assistantMessages: new Map(),
    assistantTurns: 0,
    efforts: {},
    eventMarks: [],
    events: [],
    languages: {},
    modelTokens: {},
    models: {},
    path,
    requests: [],
    tokens: zeroTokens(),
    unparsedAssistantTurns: 0,
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
  const type = asString(item.type);
  if (type === "assistant") {
    if (isRecord(item.message)) {
      collectAssistantMessage(item.message, asString(item.effort), ts, state);
    } else {
      state.unparsedAssistantTurns += 1;
    }
    return;
  }
  countRole(type, state);
}

function collectAssistantMessage(
  envelope: Record<string, unknown>,
  effort: string | undefined,
  ts: Date | undefined,
  state: ClaudeParseState,
): void {
  const message = { effort, envelope, ts };
  const id = asString(envelope.id);
  if (!id) {
    state.anonymousAssistantMessages.push(message);
    return;
  }

  const current = state.assistantMessages.get(id);
  state.assistantMessages.set(id, current ? mergeAssistantMessage(current, message) : message);
}

function mergeAssistantMessage(current: ClaudeMessage, next: ClaudeMessage): ClaudeMessage {
  const currentScore = usageCompleteness(current.envelope);
  const nextScore = usageCompleteness(next.envelope);
  const useNext =
    nextScore > currentScore ||
    (nextScore === currentScore && usageTotal(next.envelope) >= usageTotal(current.envelope));
  return {
    effort: next.effort ?? current.effort,
    envelope: useNext ? next.envelope : current.envelope,
    ts: earliestTimestamp(current.ts, next.ts),
  };
}

function earliestTimestamp(current: Date | undefined, next: Date | undefined): Date | undefined {
  if (!current || !next) {
    return current ?? next;
  }
  return current < next ? current : next;
}

function usageCompleteness(envelope: Record<string, unknown>): number {
  const usage = isRecord(envelope.usage) ? envelope.usage : undefined;
  if (!usage) {
    return 0;
  }
  const fields = [
    "input_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
    "output_tokens",
    "total_tokens",
    "reasoning_output_tokens",
  ];
  let score = fields.filter((field) => Object.hasOwn(usage, field)).length;
  if (
    isRecord(usage.output_tokens_details) &&
    Object.hasOwn(usage.output_tokens_details, "reasoning_tokens")
  ) {
    score += 1;
  }
  return score;
}

function usageTotal(envelope: Record<string, unknown>): number {
  const usage = isRecord(envelope.usage) ? envelope.usage : undefined;
  return usage
    ? asNumber(usage.input_tokens) +
        asNumber(usage.cache_read_input_tokens) +
        asNumber(usage.cache_creation_input_tokens) +
        asNumber(usage.output_tokens)
    : 0;
}

function parseClaudeMessage(message: ClaudeMessage, state: ClaudeParseState): void {
  const { effort, envelope, ts } = message;
  const model = asString(envelope.model);
  if (!isRealModel(model)) {
    return;
  }
  state.currentEffort = undefined;
  setSharedCurrentEffort(effort, ts, state);
  setCurrentModel(model, ts, state);

  const usage = isRecord(envelope.usage) ? envelope.usage : undefined;
  if (!usage) {
    return;
  }

  const parsedUsage = claudeUsageTokens(usage);
  addTokens(state.tokens, parsedUsage.tokens);
  addModelTokens(state.modelTokens, model, parsedUsage.tokens);
  addClaudeRequest(model, parsedUsage, ts, state);
}

function finishClaudeSession(state: ClaudeParseState): ParsedSession | undefined {
  const messages = [...state.assistantMessages.values(), ...state.anonymousAssistantMessages].sort(
    (a, b) => (a.ts?.getTime() ?? 0) - (b.ts?.getTime() ?? 0),
  );
  const messagesByTimestamp = new Map<number, ClaudeMessage[]>();
  for (const message of messages) {
    if (!message.ts) {
      parseClaudeMessage(message, state);
      continue;
    }
    const timestamp = message.ts.getTime();
    const bucket = messagesByTimestamp.get(timestamp) ?? [];
    bucket.push(message);
    messagesByTimestamp.set(timestamp, bucket);
  }

  state.assistantTurns = messages.length + state.unparsedAssistantTurns;
  state.currentEffort = undefined;
  state.currentModel = undefined;
  state.eventMarks = [];
  for (const ts of [...state.events].sort((a, b) => a.getTime() - b.getTime())) {
    state.eventMarks.push({ effort: state.currentEffort, model: state.currentModel, ts });
    const timestamp = ts.getTime();
    for (const message of messagesByTimestamp.get(timestamp) ?? []) {
      parseClaudeMessage(message, state);
    }
    messagesByTimestamp.delete(timestamp);
  }

  return buildParsedSession(state, {
    efforts: state.efforts,
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

type ClaudeUsage = {
  cacheWriteAvailability: "known" | "unknown";
  reasoningAvailability: "known" | "unknown";
  tokens: ParsedSession["tokens"];
};

function addClaudeRequest(
  model: string,
  usage: ClaudeUsage,
  ts: Date | undefined,
  state: ClaudeParseState,
): void {
  addRequest(state.requests, {
    effort: state.currentEffort,
    model,
    repo: repoName(state.cwd),
    sessionId: finalSessionId(state.sessionId, state.path),
    source: "claude",
    telemetry: {
      cacheWrite: usage.cacheWriteAvailability,
      reasoning: usage.reasoningAvailability,
    },
    tokens: usage.tokens,
    ts,
  });
}

function claudeUsageTokens(usage: Record<string, unknown>): ClaudeUsage {
  const input = asNumber(usage.input_tokens);
  const cached = asNumber(usage.cache_read_input_tokens);
  const cacheWriteAvailability = Object.hasOwn(usage, "cache_creation_input_tokens")
    ? "known"
    : "unknown";
  const cacheWrite = asNumber(usage.cache_creation_input_tokens);
  const rawOutput = asNumber(usage.output_tokens);
  const reasoning = explicitReasoningTokens(usage);
  const reasoningTokens = reasoning?.tokens ?? 0;
  const output = reasoning?.includedInOutput ? Math.max(0, rawOutput - reasoningTokens) : rawOutput;
  const fallbackTotal =
    input + cached + cacheWrite + rawOutput + (reasoning?.includedInOutput ? 0 : reasoningTokens);
  return {
    cacheWriteAvailability,
    reasoningAvailability: reasoning === undefined ? "unknown" : "known",
    tokens: {
      cacheWrite,
      cached,
      input,
      output,
      reasoning: reasoningTokens,
      total: asNumber(usage.total_tokens) || fallbackTotal,
    },
  };
}

function explicitReasoningTokens(
  usage: Record<string, unknown>,
): { includedInOutput: boolean; tokens: number } | undefined {
  const details = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : undefined;
  if (details && Object.hasOwn(details, "reasoning_tokens")) {
    return {
      includedInOutput: true,
      tokens: Math.min(asNumber(details.reasoning_tokens), asNumber(usage.output_tokens)),
    };
  }
  if (Object.hasOwn(usage, "reasoning_output_tokens")) {
    return { includedInOutput: false, tokens: asNumber(usage.reasoning_output_tokens) };
  }
  return undefined;
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
