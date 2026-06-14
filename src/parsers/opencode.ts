import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import initSqlJs from "sql.js";

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
  parseEpochMs,
} from "../report-core.js";

let sqlJsPromise: ReturnType<typeof initSqlJs> | undefined;

type OpencodeSessionRow = {
  directory?: string;
  id?: string;
  metadata?: string | null;
  model?: string | null;
  time_created?: number | string | null;
  time_updated?: number | string | null;
  title?: string | null;
  tokens_cache_read?: number | string | null;
  tokens_cache_write?: number | string | null;
  tokens_input?: number | string | null;
  tokens_output?: number | string | null;
  tokens_reasoning?: number | string | null;
};

type OpencodeMessageRow = {
  data?: string;
  session_id?: string;
  time_created?: number | string | null;
  time_updated?: number | string | null;
};

export async function parseOpencodeDb(path: string, scopeStart?: Date): Promise<ParsedSession[]> {
  if (!existsSync(path)) {
    return [];
  }

  const cutoffMs = scopeStart?.getTime();
  const [sessionRows, messageRows] = await Promise.all([
    queryJson<OpencodeSessionRow>(
      path,
      [
        "select id, directory, title, time_created, time_updated, model, metadata,",
        "       tokens_input, tokens_output, tokens_reasoning,",
        "       tokens_cache_read, tokens_cache_write",
        "from session",
        cutoffMs ? "where time_updated >= ?" : "",
      ].join(" "),
      cutoffMs === undefined ? [] : [cutoffMs],
    ),
    queryJson<OpencodeMessageRow>(
      path,
      [
        "select session_id, time_created, time_updated, data",
        "from message",
        cutoffMs ? "where session_id in (select id from session where time_updated >= ?)" : "",
        "order by session_id, time_created, id",
      ].join(" "),
      cutoffMs === undefined ? [] : [cutoffMs],
    ),
  ]);

  return parseOpencodeRows({
    dbPath: path,
    messageRows,
    sessionRows,
  });
}

export async function parseOpencodeRows({
  dbPath,
  messageRows,
  sessionRows,
}: {
  dbPath: string;
  messageRows: OpencodeMessageRow[];
  sessionRows: OpencodeSessionRow[];
}): Promise<ParsedSession[]> {
  const groupedMessages = new Map<string, OpencodeMessageRow[]>();
  for (const row of messageRows) {
    const sessionId = asString(row.session_id);
    if (!sessionId) {
      continue;
    }
    const bucket = groupedMessages.get(sessionId) ?? [];
    bucket.push(row);
    groupedMessages.set(sessionId, bucket);
  }

  const sessions: ParsedSession[] = [];
  for (const row of sessionRows) {
    const session = await parseSessionRow(
      row,
      groupedMessages.get(asString(row.id) ?? "") ?? [],
      dbPath,
    );
    if (session) {
      sessions.push(session);
    }
  }
  return sessions;
}

// fallow-ignore-next-line complexity
async function parseSessionRow(
  row: OpencodeSessionRow,
  messages: OpencodeMessageRow[],
  dbPath: string,
): Promise<ParsedSession | undefined> {
  const sessionId = asString(row.id);
  if (!sessionId) {
    return undefined;
  }

  let cwd = asString(row.directory);
  let currentModel: string | undefined;
  let currentEffort: string | undefined;

  const events: Date[] = [];
  const eventMarks: Array<{ effort?: string; model?: string; ts: Date }> = [];
  let tokens = zeroTokens();
  const languages: Record<string, number> = {};
  const models: Record<string, number> = {};
  const efforts: Record<string, number> = {};
  const modelTokens: ParsedSession["modelTokens"] = {};
  const requests: ParsedSession["requests"] = [];
  let userTurns = 0;
  let assistantTurns = 0;

  for (const rawTs of [row.time_created, row.time_updated]) {
    const ts = parseEpochMs(rawTs);
    if (ts) {
      events.push(ts);
      eventMarks.push({ effort: currentEffort, model: currentModel, ts });
    }
  }

  const originator = isT3CodeSession(row.title, row.metadata) ? "t3code_desktop" : "opencode";
  const fallbackModel = parseFallbackModel(row.model);
  const fallbackEffort = parseFallbackVariant(row.model);

  currentEffort = fallbackEffort;

  const title = asString(row.title);
  if (title) {
    mergeCounts(languages, inferLanguages(title));
  }

  const diffPath = join(dirname(dbPath), "storage", "session_diff", `${sessionId}.json`);
  if (existsSync(diffPath)) {
    try {
      mergeCounts(languages, inferLanguages(await readFile(diffPath, "utf8")));
    } catch {}
  }

  for (const messageRow of messages) {
    for (const rawTs of [messageRow.time_created, messageRow.time_updated]) {
      const ts = parseEpochMs(rawTs);
      if (ts) {
        events.push(ts);
        eventMarks.push({ effort: currentEffort, model: currentModel, ts });
      }
    }

    const rawData = messageRow.data ?? "";
    mergeCounts(languages, inferLanguages(rawData));

    let data: unknown;
    try {
      data = JSON.parse(rawData);
    } catch {
      continue;
    }
    if (!isRecord(data)) {
      continue;
    }

    const timeInfo = isRecord(data.time) ? data.time : undefined;
    for (const rawTs of [timeInfo?.created, timeInfo?.completed]) {
      const ts = parseEpochMs(rawTs);
      if (ts) {
        events.push(ts);
        eventMarks.push({ effort: currentEffort, model: currentModel, ts });
      }
    }

    const pathInfo = isRecord(data.path) ? data.path : undefined;
    cwd = asString(pathInfo?.cwd) ?? asString(pathInfo?.root) ?? cwd;

    const effort = asString(data.variant);
    if (effort) {
      efforts[effort] = (efforts[effort] ?? 0) + 1;
      currentEffort = effort;
      const ts = parseEpochMs(timeInfo?.created);
      if (ts) {
        eventMarks.push({ effort: currentEffort, model: currentModel, ts });
      }
    }

    const role = asString(data.role);
    if (role === "user") {
      userTurns += 1;
    } else if (role === "assistant") {
      assistantTurns += 1;
    }
    if (role !== "assistant") {
      continue;
    }

    const model = asString(data.modelID) ?? fallbackModel;
    if (model) {
      models[model] = (models[model] ?? 0) + 1;
      currentModel = model;
      for (const rawTs of [timeInfo?.created, timeInfo?.completed, messageRow.time_updated]) {
        const ts = parseEpochMs(rawTs);
        if (ts) {
          eventMarks.push({ effort: currentEffort, model: currentModel, ts });
        }
      }
    }

    const usage = isRecord(data.tokens) ? data.tokens : undefined;
    const cache = isRecord(usage?.cache) ? usage.cache : undefined;
    const input = asNumber(usage?.input);
    const cached = asNumber(cache?.read);
    const cacheWrite = asNumber(cache?.write);
    const output = asNumber(usage?.output);
    const reasoning = asNumber(usage?.reasoning);
    const total = asNumber(usage?.total) || input + cached + cacheWrite + output + reasoning;

    tokens.input += input;
    tokens.cached += cached;
    tokens.cacheWrite += cacheWrite;
    tokens.output += output;
    tokens.reasoning += reasoning;
    tokens.total += total;

    if (model) {
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
    }

    addRequest(requests, {
      effort: currentEffort,
      model,
      originator,
      repo: repoName(cwd),
      sessionId,
      source: "opencode",
      tokens: {
        cacheWrite,
        cached,
        input,
        output,
        reasoning,
        total,
      },
      ts: parseEpochMs(timeInfo?.completed) ?? parseEpochMs(messageRow.time_updated),
    });
  }

  if (events.length === 0) {
    return undefined;
  }

  if (tokens.total === 0) {
    if (fallbackEffort) {
      efforts[fallbackEffort] = (efforts[fallbackEffort] ?? 0) + 1;
    }
    tokens = {
      cacheWrite: asNumber(row.tokens_cache_write),
      cached: asNumber(row.tokens_cache_read),
      input: asNumber(row.tokens_input),
      output: asNumber(row.tokens_output),
      reasoning: asNumber(row.tokens_reasoning),
      total:
        asNumber(row.tokens_input) +
        asNumber(row.tokens_cache_read) +
        asNumber(row.tokens_cache_write) +
        asNumber(row.tokens_output) +
        asNumber(row.tokens_reasoning),
    };
    if (fallbackModel) {
      models[fallbackModel] = (models[fallbackModel] ?? 0) + 1;
      modelTokens[fallbackModel] = {
        billableOutput: tokens.output + tokens.reasoning,
        cacheWrite: tokens.cacheWrite,
        cached: tokens.cached,
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning,
        total: tokens.total,
      };
    }
  }

  events.sort((a, b) => a.getTime() - b.getTime());
  const allocated = allocateStateTime(eventMarks);

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
    originator,
    path: dbPath,
    repo: repoName(cwd),
    requestCount: requests.length,
    requests,
    sessionId,
    source: "opencode",
    sourceLabel: sessionLabel("opencode", originator),
    start: events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens,
    userTurns,
  };
}

async function queryJson<T>(dbPath: string, query: string, params: unknown[] = []): Promise<T[]> {
  const SQL = (sqlJsPromise ??= initSqlJs());
  const db = new (await SQL).Database(await readFile(dbPath));

  try {
    const statement = db.prepare(query);
    if (params.length > 0) {
      statement.bind(params as any);
    }
    const rows: T[] = [];

    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }

    statement.free();
    return rows;
  } finally {
    db.close();
  }
}

function isT3CodeSession(title: unknown, metadata: unknown): boolean {
  const titleText = typeof title === "string" ? title.trim() : "";
  if (/^T3 Code(?:\s|$)/i.test(titleText)) {
    return true;
  }
  if (typeof metadata !== "string") {
    return false;
  }
  return metadata.toLowerCase().includes("t3code");
}

function parseFallbackModel(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? asString(parsed.id) : undefined;
  } catch {
    return undefined;
  }
}

function parseFallbackVariant(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? asString(parsed.variant) : undefined;
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
