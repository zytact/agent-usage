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

export function parseClaudeSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let currentModel: string | undefined;

  const events: Date[] = [];
  const eventMarks: Array<{ effort?: string; model?: string; ts: Date }> = [];
  const tokens = zeroTokens();
  const languages: Record<string, number> = {};
  const models: Record<string, number> = {};
  const efforts: Record<string, number> = {};
  const modelTokens: ParsedSession["modelTokens"] = {};
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
      eventMarks.push({ model: currentModel, ts });
    }

    sessionId = asString(item.sessionId) ?? sessionId;
    cwd = asString(item.cwd) ?? cwd;

    const role = asString(item.type);
    if (role === "user") {
      userTurns += 1;
    } else if (role === "assistant") {
      assistantTurns += 1;
    }

    const envelope = isRecord(item.message) ? item.message : undefined;
    const model = asString(envelope?.model);
    if (model && model !== "<synthetic>") {
      models[model] = (models[model] ?? 0) + 1;
      currentModel = model;
      if (ts) {
        eventMarks.push({ model: currentModel, ts });
      }
    }

    const usage = isRecord(envelope?.usage) ? envelope.usage : undefined;
    if (!usage) {
      continue;
    }

    const input = asNumber(usage.input_tokens);
    const cached = asNumber(usage.cache_read_input_tokens);
    const cacheWrite = asNumber(usage.cache_creation_input_tokens);
    const output = asNumber(usage.output_tokens);
    const reasoning = sumIterationOutput(usage.iterations);
    const total = asNumber(usage.total_tokens) || input + cached + cacheWrite + output + reasoning;

    tokens.input += input;
    tokens.cached += cached;
    tokens.cacheWrite += cacheWrite;
    tokens.output += output;
    tokens.reasoning += reasoning;
    tokens.total += total;

    if (!model || model === "<synthetic>") {
      continue;
    }

    const bucket = (modelTokens[model] ??= {
      billableOutput: 0,
      cacheWrite: 0,
      cached: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      total: 0,
    });
    bucket.input += input;
    bucket.cached += cached;
    bucket.cacheWrite += cacheWrite;
    bucket.output += output;
    bucket.reasoning += reasoning;
    bucket.billableOutput += output + reasoning;
    bucket.total += total;

    addRequest(requests, {
      model,
      repo: repoName(cwd),
      sessionId:
        sessionId ??
        path
          .split("/")
          .pop()
          ?.replace(/\.jsonl$/, "") ??
        "unknown",
      source: "claude",
      tokens: {
        cacheWrite,
        cached,
        input,
        output,
        reasoning,
        total,
      },
      ts,
    });
  }

  if (events.length === 0) {
    return undefined;
  }

  events.sort((a, b) => a.getTime() - b.getTime());
  const allocated = allocateStateTime(eventMarks);
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
    path,
    repo: repoName(cwd),
    requestCount: requests.length,
    requests,
    sessionId: finalSessionId,
    source: "claude",
    sourceLabel: sessionLabel("claude", undefined),
    start: events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: { ...tokens },
    userTurns,
  };
}

function sumIterationOutput(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }

  let total = 0;
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    total += asNumber(item.output_tokens);
  }
  return total;
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
