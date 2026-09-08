import { readFile } from "node:fs/promises";

import type { ParsedSession } from "../domain.js";
import { addRequest, repoName, sessionLabel, zeroTokens } from "../ingest-shared.js";
import { parseTimestamp } from "../report-core.js";
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
  parseJsonObject,
  parseSessionText,
  prepareJsonLine,
  setCurrentModel as setSharedCurrentModel,
} from "./shared.js";

export async function parsePiSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parsePiSessionText(content, path);
}

type PiParseState = ModelTokenParserState & {
  currentProvider?: string;
  effortMarks: Record<string, number>;
  originator?: string;
  workflowAgentLabel?: string;
  workflowRunId?: string;
};

export function parsePiSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  return parseSessionText(
    withoutInheritedHistory(content),
    path,
    createPiState,
    parsePiLine,
    finishPiSession,
  );
}

/**
 * Forking or cloning a session copies the source's entries into the new file with their
 * original timestamps and records the source in the header's `parentSession`. The source
 * file still holds those entries, so keep only what the forked session added afterwards.
 * Returns nothing when the fork added nothing of its own.
 */
function withoutInheritedHistory(content: string): string {
  const lines = content.split("\n");
  const header = parseJsonObject((lines[0] ?? "").trim());
  if (!header || header.type !== "session" || !asString(header.parentSession)) {
    return content;
  }

  const forkedAtMs = timestampMs(header);
  if (forkedAtMs === undefined) {
    return content;
  }

  const firstOwn = lines.findIndex((line, index) => index > 0 && isAtOrAfter(line, forkedAtMs));
  return firstOwn === -1 ? "" : [lines[0], ...lines.slice(firstOwn)].join("\n");
}

/** Copied entries are strictly older than the fork header, so the boundary itself is the fork's. */
function isAtOrAfter(line: string, cutoffMs: number): boolean {
  const item = parseJsonObject(line.trim());
  const ms = item ? timestampMs(item) : undefined;
  return ms !== undefined && ms >= cutoffMs;
}

function timestampMs(item: Record<string, unknown>): number | undefined {
  const timestamp = asString(item.timestamp);
  return timestamp ? parseTimestamp(timestamp)?.getTime() : undefined;
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
  if (applyPiMetadata(item, state)) return;
  if (item.type === "model_change") {
    state.currentProvider = asString(item.provider) ?? state.currentProvider;
    setCurrentModel(asString(item.modelId), ts, state);
    return;
  }
  if (item.type === "thinking_level_change") {
    setCurrentEffort(asString(item.thinkingLevel), ts, state);
    return;
  }
  if (item.type === "message") {
    parsePiMessage(item, ts, state);
    return;
  }
  // Compaction and branch summaries are model calls too, and carry the summarising
  // request's usage on the entry itself rather than on a message.
  if (item.type === "compaction" || item.type === "branch_summary") {
    addPiUsage(item.usage, undefined, undefined, ts, state);
  }
}

function parsePiMessage(
  item: Record<string, unknown>,
  ts: Date | undefined,
  state: PiParseState,
): void {
  const message = isRecord(item.message) ? item.message : undefined;
  countRole(asString(message?.role), state);

  const model = asString(message?.model);
  const provider = asString(message?.provider);
  if (provider) {
    state.currentProvider = provider;
  }
  setCurrentModel(model, ts, state);
  addPiUsage(message?.usage, model, provider, ts, state);
}

/**
 * Every usage record Pi writes becomes a Request, so session totals and request accounting
 * cannot drift apart and Scope clipping keeps all of it. Tool results and summaries report
 * usage the same way assistant messages do.
 */
function addPiUsage(
  rawUsage: unknown,
  model: string | undefined,
  provider: string | undefined,
  ts: Date | undefined,
  state: PiParseState,
): void {
  const usage = isRecord(rawUsage) ? rawUsage : undefined;
  // Pi timestamps every entry. Requiring one here keeps session totals and requests equal.
  if (!usage || !ts) {
    return;
  }

  const tokens = piUsageTokens(usage);
  const usageModel = model ?? state.currentModel;
  const usageProvider = provider ?? state.currentProvider;
  addTokens(state.tokens, tokens);
  addModelTokens(state.modelTokens, usageModel, tokens, usageProvider);
  addRequest(state.requests, {
    effort: state.currentEffort,
    model: usageModel,
    originator: state.originator,
    provider: usageProvider,
    repo: repoName(state.cwd),
    sessionId: finalSessionId(state.sessionId, state.path),
    source: "pi",
    telemetry: {
      reasoning: Object.hasOwn(usage, "reasoning") ? "known" : "unknown",
    },
    tokens,
    ts,
  });
}

function finishPiSession(state: PiParseState): ParsedSession | undefined {
  return buildParsedSession(state, {
    efforts: state.effortMarks,
    modelTokens: state.modelTokens,
    originator: state.originator,
    source: "pi",
    sourceLabel: sessionLabel("pi", state.originator),
    workflowAgentLabel: state.workflowAgentLabel,
    workflowRunId: state.workflowRunId,
  });
}

function applyPiMetadata(item: Record<string, unknown>, state: PiParseState): boolean {
  if (item.type === "session") {
    state.sessionId = asString(item.id) ?? state.sessionId;
    state.cwd = asString(item.cwd) ?? state.cwd;
    state.originator = inferPiOriginator(item, state.path) ?? state.originator;
    return true;
  }
  if (item.type !== "session_info") return false;
  applyPiSessionInfo(item, state);
  return true;
}

function applyPiSessionInfo(item: Record<string, unknown>, state: PiParseState): void {
  const workflow = parseWorkflowSessionName(asString(item.name));
  if (!workflow) return;
  state.originator = "pi-dynamic-workflows";
  state.workflowRunId = workflow.runId;
  state.workflowAgentLabel = workflow.label;
}

function parseWorkflowSessionName(
  name: string | undefined,
): { label: string; runId: string } | undefined {
  const match = name?.match(/^workflow:(\S+)\s+(.+)$/);
  return match ? { runId: match[1], label: match[2] } : undefined;
}

/**
 * `parentSession` marks a fork, clone, or continued session, not a subagent, so it says
 * nothing about who started this session.
 */
function inferPiOriginator(item: Record<string, unknown>, path: string): string | undefined {
  const originator = asString(item.originator);
  const threadSource = asString(item.thread_source);
  if (isSubagentText(originator) || isSubagentText(threadSource) || isSubagentSessionPath(path)) {
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
  const reasoning = asNumber(usage.reasoning);
  return {
    cacheWrite,
    cacheWrite1h: 0,
    cached,
    input,
    output,
    reasoning,
    total: asNumber(usage.totalTokens) || input + cached + cacheWrite + output + reasoning,
  };
}
