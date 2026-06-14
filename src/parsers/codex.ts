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

export async function parseCodexSessionFile(path: string): Promise<ParsedSession | undefined> {
  const content = await readFile(path, "utf8");
  return parseCodexSessionText(content, path);
}

export function parseCodexSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let originator: string | undefined;
  let currentModel: string | undefined;
  let currentEffort: string | undefined;

  const events: Date[] = [];
  const eventMarks: Array<{ effort?: string; model?: string; ts: Date }> = [];
  const tokens = zeroTokens();
  const languages: Record<string, number> = {};
  const models: Record<string, number> = {};
  const efforts: Record<string, number> = {};
  const requests: ParsedSession["requests"] = [];
  let userTurns = 0;
  let assistantTurns = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    mergeCounts(languages, inferLanguages(line));

    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }

    const ts = typeof item.timestamp === "string" ? parseTimestamp(item.timestamp) : undefined;
    if (ts) {
      events.push(ts);
      eventMarks.push({ effort: currentEffort, model: currentModel, ts });
    }

    const payload = isRecord(item.payload) ? item.payload : undefined;

    if (item.type === "session_meta" && payload) {
      sessionId = asString(payload.id) ?? sessionId;
      cwd = asString(payload.cwd) ?? cwd;
      originator = asString(payload.originator) ?? originator;
    }

    if (item.type === "turn_context" && payload) {
      const model = asString(payload.model);
      if (model) {
        models[model] = (models[model] ?? 0) + 1;
        currentModel = model;
        if (ts) {
          eventMarks.push({ effort: currentEffort, model: currentModel, ts });
        }
      }

      const effort = asString(payload.effort) ?? nestedReasoningEffort(payload);
      if (effort) {
        efforts[effort] = (efforts[effort] ?? 0) + 1;
        currentEffort = effort;
        if (ts) {
          eventMarks.push({ effort: currentEffort, model: currentModel, ts });
        }
      }
    }

    if (item.type === "response_item" && payload?.type === "message") {
      if (payload.role === "assistant") {
        assistantTurns += 1;
      }
      if (payload.role === "user") {
        userTurns += 1;
      }
    }

    if (item.type === "event_msg" && payload?.type === "token_count") {
      const info = isRecord(payload.info) ? payload.info : undefined;
      const totalUsage = isRecord(info?.total_token_usage) ? info.total_token_usage : undefined;
      const lastUsage = isRecord(info?.last_token_usage) ? info.last_token_usage : undefined;
      if (!totalUsage || !lastUsage) {
        continue;
      }

      const rawInput = asNumber(totalUsage.input_tokens);
      const cached = asNumber(totalUsage.cached_input_tokens);
      tokens.input = Math.max(rawInput - cached, 0);
      tokens.cached = cached;
      tokens.cacheWrite = 0;
      tokens.output = asNumber(totalUsage.output_tokens);
      tokens.reasoning = asNumber(totalUsage.reasoning_output_tokens);
      tokens.total =
        asNumber(totalUsage.total_tokens) || tokens.input + tokens.cached + tokens.output;

      const reqRawInput = asNumber(lastUsage.input_tokens);
      const reqCached = asNumber(lastUsage.cached_input_tokens);
      addRequest(requests, {
        effort: currentEffort,
        model: currentModel,
        originator,
        repo: repoName(cwd),
        sessionId:
          sessionId ??
          path
            .split("/")
            .pop()
            ?.replace(/\.jsonl$/, "") ??
          "unknown",
        source: "codex",
        tokens: {
          cacheWrite: 0,
          cached: reqCached,
          input: Math.max(reqRawInput - reqCached, 0),
          output: asNumber(lastUsage.output_tokens),
          reasoning: asNumber(lastUsage.reasoning_output_tokens),
          total: asNumber(lastUsage.total_tokens),
        },
        ts,
      });
    }
  }

  if (events.length === 0) {
    return undefined;
  }

  events.sort((a, b) => a.getTime() - b.getTime());
  const allocated = allocateStateTime(eventMarks);
  const modelTokens = distributeModelTokens(tokens, models);
  const finalSessionId =
    sessionId ??
    path
      .split("/")
      .pop()
      ?.replace(/\.jsonl$/, "") ??
    "unknown";

  return {
    activeSeconds: allocated.totalSeconds,
    assistantTurns,
    cwd,
    dayModelActiveSeconds: collapseDayStateSeconds(allocated.byDayStateSeconds),
    dayStateActiveSeconds: allocated.byDayStateSeconds,
    end: events.at(-1) ?? events[0],
    efforts,
    languages,
    modelActiveSeconds: collapseStateSeconds(allocated.byStateSeconds),
    modelTokens,
    models,
    originator: originator ?? "unknown",
    path,
    repo: repoName(cwd),
    requestCount: requests.length,
    requests,
    sessionId: finalSessionId,
    source: "codex",
    sourceLabel: sessionLabel("codex", originator),
    start: events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: { ...tokens },
    userTurns,
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
