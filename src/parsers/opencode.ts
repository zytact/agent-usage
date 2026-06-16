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

type OpencodeParseContext = {
  assistantTurns: number;
  currentEffort?: string;
  currentModel?: string;
  cwd?: string;
  efforts: Record<string, number>;
  eventMarks: Array<{ effort?: string; model?: string; ts: Date }>;
  events: Date[];
  languages: Record<string, number>;
  modelTokens: ParsedSession["modelTokens"];
  models: Record<string, number>;
  requests: ParsedSession["requests"];
  tokens: ParsedSession["tokens"];
  userTurns: number;
};

async function parseSessionRow(
  row: OpencodeSessionRow,
  messages: OpencodeMessageRow[],
  dbPath: string,
): Promise<ParsedSession | undefined> {
  const sessionId = asString(row.id);
  if (!sessionId) {
    return undefined;
  }

  const originator = isT3CodeSession(row.title, row.metadata) ? "t3code_desktop" : "opencode";
  const fallbackModel = parseFallbackModel(row.model);
  const fallbackEffort = parseFallbackVariant(row.model);
  const context = createParseContext(row, fallbackEffort);

  await mergeSessionLanguages(context, row, dbPath, sessionId);

  for (const messageRow of messages) {
    processMessage(context, messageRow, {
      fallbackModel,
      originator,
      sessionId,
    });
  }

  if (context.events.length === 0) {
    return undefined;
  }

  applyFallbackUsage(context, row, fallbackEffort, fallbackModel);
  return buildParsedSession(context, dbPath, originator, sessionId);
}

function createParseContext(
  row: OpencodeSessionRow,
  fallbackEffort: string | undefined,
): OpencodeParseContext {
  const context: OpencodeParseContext = {
    assistantTurns: 0,
    cwd: asString(row.directory),
    efforts: {},
    eventMarks: [],
    events: [],
    languages: {},
    modelTokens: {},
    models: {},
    requests: [],
    tokens: zeroTokens(),
    userTurns: 0,
  };

  pushTimestamps(context, [row.time_created, row.time_updated]);
  context.currentEffort = fallbackEffort;
  return context;
}

async function mergeSessionLanguages(
  context: OpencodeParseContext,
  row: OpencodeSessionRow,
  dbPath: string,
  sessionId: string,
): Promise<void> {
  const title = asString(row.title);
  if (title) {
    mergeCounts(context.languages, inferLanguages(title));
  }

  const diffPath = join(dirname(dbPath), "storage", "session_diff", `${sessionId}.json`);
  if (!existsSync(diffPath)) {
    return;
  }

  try {
    mergeCounts(context.languages, inferLanguages(await readFile(diffPath, "utf8")));
  } catch {}
}

function applyMessageTimestamps(context: OpencodeParseContext, row: OpencodeMessageRow): void {
  pushTimestamps(context, [row.time_created, row.time_updated]);
}

function processMessage(
  context: OpencodeParseContext,
  messageRow: OpencodeMessageRow,
  meta: { fallbackModel?: string; originator: string; sessionId: string },
): void {
  applyMessageTimestamps(context, messageRow);
  const data = parseMessageData(context, messageRow.data ?? "");
  if (!data) {
    return;
  }

  const timeInfo = toRecord(data.time);
  applyNestedTimestamps(context, timeInfo);
  updateCwd(context, data);
  applyEffort(context, data, timeInfo);

  const role = asString(data.role);
  countRole(context, role);
  if (role !== "assistant") {
    return;
  }

  const model = applyModel(context, data, timeInfo, messageRow, meta.fallbackModel);
  const usage = usageFromMessage(data);
  applyUsage(context, usage, model);
  addRequest(context.requests, {
    effort: context.currentEffort,
    model,
    originator: meta.originator,
    repo: repoName(context.cwd),
    sessionId: meta.sessionId,
    source: "opencode",
    tokens: usage,
    ts: parseEpochMs(timeInfo?.completed) ?? parseEpochMs(messageRow.time_updated),
  });
}

function parseMessageData(
  context: OpencodeParseContext,
  rawData: string,
): Record<string, any> | undefined {
  mergeCounts(context.languages, inferLanguages(rawData));

  try {
    const data: unknown = JSON.parse(rawData);
    return isRecord(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

function applyNestedTimestamps(
  context: OpencodeParseContext,
  timeInfo: Record<string, any> | undefined,
): void {
  pushTimestamps(context, [timeInfo?.created, timeInfo?.completed]);
}

function updateCwd(context: OpencodeParseContext, data: Record<string, any>): void {
  const pathInfo = toRecord(data.path);
  context.cwd = asString(pathInfo?.cwd) ?? asString(pathInfo?.root) ?? context.cwd;
}

function applyEffort(
  context: OpencodeParseContext,
  data: Record<string, any>,
  timeInfo: Record<string, any> | undefined,
): void {
  const effort = asString(data.variant);
  if (!effort) {
    return;
  }

  context.efforts[effort] = (context.efforts[effort] ?? 0) + 1;
  context.currentEffort = effort;
  pushMarks(context, [parseEpochMs(timeInfo?.created)]);
}

function countRole(context: OpencodeParseContext, role: string | undefined): void {
  if (role === "user") {
    context.userTurns += 1;
  } else if (role === "assistant") {
    context.assistantTurns += 1;
  }
}

function applyModel(
  context: OpencodeParseContext,
  data: Record<string, any>,
  timeInfo: Record<string, any> | undefined,
  row: OpencodeMessageRow,
  fallbackModel: string | undefined,
): string | undefined {
  const model = asString(data.modelID) ?? fallbackModel;
  if (!model) {
    return undefined;
  }

  context.models[model] = (context.models[model] ?? 0) + 1;
  context.currentModel = model;
  pushMarks(context, [
    parseEpochMs(timeInfo?.created),
    parseEpochMs(timeInfo?.completed),
    parseEpochMs(row.time_updated),
  ]);
  return model;
}

function usageFromMessage(data: Record<string, any>): ParsedSession["tokens"] {
  const usage = toRecord(data.tokens);
  const cache = toRecord(usage?.cache);
  const values = {
    cacheWrite: asNumber(cache?.write),
    cached: asNumber(cache?.read),
    input: asNumber(usage?.input),
    output: asNumber(usage?.output),
    reasoning: asNumber(usage?.reasoning),
  };

  return {
    ...values,
    total:
      asNumber(usage?.total) ||
      values.input + values.cached + values.cacheWrite + values.output + values.reasoning,
  };
}

function applyUsage(
  context: OpencodeParseContext,
  usage: ParsedSession["tokens"],
  model: string | undefined,
): void {
  context.tokens.input += usage.input;
  context.tokens.cached += usage.cached;
  context.tokens.cacheWrite += usage.cacheWrite;
  context.tokens.output += usage.output;
  context.tokens.reasoning += usage.reasoning;
  context.tokens.total += usage.total;

  if (!model) {
    return;
  }

  const bucket = (context.modelTokens[model] ??= {
    billableOutput: 0,
    cacheWrite: 0,
    cached: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  });
  bucket.input += usage.input;
  bucket.cached += usage.cached;
  bucket.cacheWrite += usage.cacheWrite;
  bucket.output += usage.output;
  bucket.reasoning += usage.reasoning;
  bucket.billableOutput += usage.output + usage.reasoning;
  bucket.total += usage.total;
}

function applyFallbackUsage(
  context: OpencodeParseContext,
  row: OpencodeSessionRow,
  fallbackEffort: string | undefined,
  fallbackModel: string | undefined,
): void {
  if (context.tokens.total !== 0) {
    return;
  }

  if (fallbackEffort) {
    context.efforts[fallbackEffort] = (context.efforts[fallbackEffort] ?? 0) + 1;
  }

  context.tokens = {
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

  if (!fallbackModel) {
    return;
  }

  context.models[fallbackModel] = (context.models[fallbackModel] ?? 0) + 1;
  context.modelTokens[fallbackModel] = {
    billableOutput: context.tokens.output + context.tokens.reasoning,
    cacheWrite: context.tokens.cacheWrite,
    cached: context.tokens.cached,
    input: context.tokens.input,
    output: context.tokens.output,
    reasoning: context.tokens.reasoning,
    total: context.tokens.total,
  };
}

function buildParsedSession(
  context: OpencodeParseContext,
  dbPath: string,
  originator: string,
  sessionId: string,
): ParsedSession {
  context.events.sort((a, b) => a.getTime() - b.getTime());
  const allocated = allocateStateTime(context.eventMarks);

  return {
    activeSeconds: allocated.totalSeconds,
    assistantTurns: context.assistantTurns,
    cwd: context.cwd,
    dayModelActiveSeconds: collapseDayStateSeconds(allocated.byDayStateSeconds),
    dayStateActiveSeconds: allocated.byDayStateSeconds,
    end: context.events.at(-1) ?? context.events[0],
    efforts: context.efforts,
    languages: context.languages,
    modelActiveSeconds: collapseStateSeconds(allocated.byStateSeconds),
    modelTokens: context.modelTokens,
    models: context.models,
    originator,
    path: dbPath,
    repo: repoName(context.cwd),
    requestCount: context.requests.length,
    requests: context.requests,
    sessionId,
    source: "opencode",
    sourceLabel: sessionLabel("opencode", originator),
    start: context.events[0],
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: context.tokens,
    userTurns: context.userTurns,
  };
}

function pushTimestamps(
  context: OpencodeParseContext,
  values: Array<number | string | null | undefined>,
): void {
  for (const value of values) {
    const ts = parseEpochMs(value);
    if (!ts) {
      continue;
    }
    context.events.push(ts);
    context.eventMarks.push({ effort: context.currentEffort, model: context.currentModel, ts });
  }
}

function pushMarks(context: OpencodeParseContext, timestamps: Array<Date | undefined>): void {
  for (const ts of timestamps) {
    if (!ts) {
      continue;
    }
    context.eventMarks.push({ effort: context.currentEffort, model: context.currentModel, ts });
  }
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

function toRecord(value: unknown): Record<string, any> | undefined {
  return isRecord(value) ? value : undefined;
}

function asNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
