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

export function parsePiSessionText(
  content: string,
  path = "session.jsonl",
): ParsedSession | undefined {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let currentModel: string | undefined;
  let currentEffort: string | undefined;

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
      eventMarks.push({ effort: currentEffort, model: currentModel, ts });
    }

    if (item.type === "session") {
      sessionId = asString(item.id) ?? sessionId;
      cwd = asString(item.cwd) ?? cwd;
      continue;
    }

    if (item.type === "model_change") {
      const model = asString(item.modelId);
      if (model) {
        models[model] = (models[model] ?? 0) + 1;
        currentModel = model;
        if (ts) {
          eventMarks.push({ effort: currentEffort, model: currentModel, ts });
        }
      }
      continue;
    }

    if (item.type === "thinking_level_change") {
      const effort = asString(item.thinkingLevel);
      if (effort) {
        efforts[effort] = (efforts[effort] ?? 0) + 1;
        currentEffort = effort;
        if (ts) {
          eventMarks.push({ effort: currentEffort, model: currentModel, ts });
        }
      }
      continue;
    }

    if (item.type !== "message") {
      continue;
    }

    const message = isRecord(item.message) ? item.message : undefined;
    const role = asString(message?.role);
    if (role === "user") {
      userTurns += 1;
    } else if (role === "assistant") {
      assistantTurns += 1;
    }

    const model = asString(message?.model);
    if (model) {
      models[model] = (models[model] ?? 0) + 1;
      currentModel = model;
      if (ts) {
        eventMarks.push({ effort: currentEffort, model: currentModel, ts });
      }
    }

    const usage = isRecord(message?.usage) ? message.usage : undefined;
    if (!usage) {
      continue;
    }

    const input = asNumber(usage.input);
    const cached = asNumber(usage.cacheRead);
    const cacheWrite = asNumber(usage.cacheWrite);
    const output = asNumber(usage.output);
    const total = asNumber(usage.totalTokens) || input + cached + cacheWrite + output;

    tokens.input += input;
    tokens.cached += cached;
    tokens.cacheWrite += cacheWrite;
    tokens.output += output;
    tokens.total += total;

    const tokenModel = model ?? currentModel;
    if (tokenModel) {
      const bucket = (modelTokens[tokenModel] ??= {
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
      bucket.billableOutput += output;
      bucket.total += total;
    }

    if (role === "assistant") {
      addRequest(requests, {
        effort: currentEffort,
        model: tokenModel,
        repo: repoName(cwd),
        sessionId:
          sessionId ??
          path
            .split("/")
            .pop()
            ?.replace(/\.jsonl$/, "") ??
          "unknown",
        source: "pi",
        tokens: {
          cacheWrite,
          cached,
          input,
          output,
          reasoning: 0,
          total,
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
    source: "pi",
    sourceLabel: sessionLabel("pi", undefined),
    start: events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: { ...tokens },
    userTurns,
  };
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
