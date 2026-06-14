import type { ParsedSession, SessionRequest, TokenUsage } from "./domain.js";
import { mean, percentile, scopeStart, splitStateKey, type Scope } from "./report-core.js";

export type ModelTokenUsage = TokenUsage & { billableOutput: number };

export type ReportDay = {
  activeSeconds: number;
  requestCount: number;
  sessionCount: number;
};

export type ReportStats = {
  activeSeconds: number;
  assistantTurns: number;
  days: Record<string, ReportDay>;
  efforts: Record<string, number>;
  languages: Record<string, number>;
  modelActiveSeconds: Record<string, number>;
  modelTokens: Record<string, ModelTokenUsage>;
  modelUsage: Record<string, number>;
  repos: Record<string, number>;
  requestCount: number;
  sessionCount: number;
  tokens: TokenUsage;
  userTurns: number;
};

export type DailyBreakdownRow = {
  activeSeconds: number;
  cached: number;
  date: string;
  effort: string;
  harness: string;
  input: number;
  model: string;
  output: number;
  reasoning: number;
  requests: number;
  sessions: number;
  subharness: string;
};

export type DistributionSummary = {
  max?: number;
  mean?: number;
  median?: number;
  p75?: number;
  p90?: number;
};

export type RequestContextSummary = {
  average?: number;
  final?: number;
  first?: number;
  growth?: number;
  median?: number;
  peak?: number;
};

export type RequestCacheSummary = {
  cacheReadPerRequest?: number;
  cacheReadRatio?: number;
  uncachedInputPerRequest?: number;
  weightedInputEqPerRequest?: number;
};

export type SourceSection = {
  sessions: ParsedSession[];
  stats: ReportStats;
  title: string;
  tone: string;
};

export type BuiltReport = {
  attributionOverages: Array<{
    active: number;
    attributed: number;
    sessionId: string;
    source: string;
  }>;
  combined: SourceSection;
  dailyRows: DailyBreakdownRow[];
  generatedAt: Date;
  gptOnly: SourceSection;
  includeClaude: boolean;
  requestSummarySessions: ParsedSession[];
  scope: Scope;
  scopeTitle: string;
  sections: SourceSection[];
  sourceCount: number;
};

export const SOURCE_TONES = {
  claude: "oklch(0.72 0.1 50)",
  codex: "oklch(0.681 0.132 258.4)",
  combined: "oklch(0.681 0.132 258.4)",
  gptOnly: "oklch(0.68 0.11 165)",
  opencode: "oklch(0.64 0.13 300)",
  pi: "oklch(0.7 0.11 150)",
  t3code: "oklch(0.75 0.15 70)",
  other: "oklch(0.72 0.09 210)",
} as const;

export function filterSessionsByScope(
  sessions: ParsedSession[],
  scope: Scope,
  now: Date,
): ParsedSession[] {
  const start = scopeStart(scope, now);
  return sessions.filter((session) => session.end >= start);
}

export function aggregateSessions(sessions: ParsedSession[]): ReportStats {
  const stats: ReportStats = {
    activeSeconds: 0,
    assistantTurns: 0,
    days: {},
    efforts: {},
    languages: {},
    modelActiveSeconds: {},
    modelTokens: {},
    modelUsage: {},
    repos: {},
    requestCount: 0,
    sessionCount: 0,
    tokens: zeroTokens(),
    userTurns: 0,
  };

  for (const session of sessions) {
    stats.activeSeconds += session.activeSeconds;
    stats.assistantTurns += session.assistantTurns;
    stats.requestCount += session.requestCount;
    stats.sessionCount += 1;
    stats.userTurns += session.userTurns;
    stats.repos[session.repo] = (stats.repos[session.repo] ?? 0) + session.activeSeconds;
    mergeCounts(stats.languages, session.languages);
    mergeCounts(stats.efforts, session.efforts);
    mergeCounts(stats.modelUsage, session.models);
    mergeCounts(stats.modelActiveSeconds, session.modelActiveSeconds);
    mergeTokens(stats.tokens, session.tokens);

    for (const [model, usage] of Object.entries(session.modelTokens)) {
      const bucket = (stats.modelTokens[model] ??= {
        billableOutput: 0,
        cacheWrite: 0,
        cached: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        total: 0,
      });
      bucket.billableOutput += usage.billableOutput;
      bucket.cacheWrite += usage.cacheWrite;
      bucket.cached += usage.cached;
      bucket.input += usage.input;
      bucket.output += usage.output;
      bucket.reasoning += usage.reasoning;
      bucket.total += usage.total;
    }

    const dayKey = session.start.toISOString().slice(0, 10);
    const day = (stats.days[dayKey] ??= {
      activeSeconds: 0,
      requestCount: 0,
      sessionCount: 0,
    });
    day.activeSeconds += session.activeSeconds;
    day.requestCount += session.requestCount;
    day.sessionCount += 1;
  }

  return stats;
}

export function buildReport(
  sessions: ParsedSession[],
  scope: Scope,
  includeClaude: boolean,
  now: Date,
): BuiltReport {
  const filtered = filterSessionsByScope(sessions, scope, now);
  const codex = filtered.filter((session) => session.source === "codex");
  const opencode = filtered.filter((session) => session.source === "opencode");
  const claude = filtered.filter((session) => session.source === "claude");
  const pi = filtered.filter((session) => session.source === "pi");
  const codexT3 = codex.filter((session) => session.originator === "t3code_desktop");
  const codexOther = codex.filter((session) => session.originator !== "t3code_desktop");
  const opencodeT3 = opencode.filter((session) => session.originator === "t3code_desktop");
  const opencodeOther = opencode.filter((session) => session.originator !== "t3code_desktop");
  const gptOnlySessions = filterSessionsByModel(filtered, isGptModel);

  const sections: SourceSection[] = [
    makeSection("Combined", filtered, SOURCE_TONES.combined),
    makeSection("GPT-only", gptOnlySessions, SOURCE_TONES.gptOnly),
    makeSection("Codex", codex, SOURCE_TONES.codex),
    makeSection("Codex via T3 Code", codexT3, SOURCE_TONES.t3code),
    makeSection("Codex other", codexOther, SOURCE_TONES.other),
    makeSection("opencode", opencode, SOURCE_TONES.opencode),
    makeSection("opencode via T3 Code", opencodeT3, SOURCE_TONES.t3code),
    makeSection("opencode other", opencodeOther, SOURCE_TONES.other),
  ];

  if (includeClaude) {
    sections.push(makeSection("Claude Code", claude, SOURCE_TONES.claude));
  }

  sections.push(makeSection("Pi", pi, SOURCE_TONES.pi));

  return {
    attributionOverages: attributionOverageRows(filtered),
    combined: sections[0],
    dailyRows: groupedDailyModelBreakdown(filtered),
    generatedAt: now,
    gptOnly: sections[1],
    includeClaude,
    requestSummarySessions: filtered,
    scope,
    scopeTitle: formatScopeTitle(scope, now),
    sections,
    sourceCount: 3 + (includeClaude ? 1 : 0),
  };
}

export function groupedDailyModelBreakdown(sessions: ParsedSession[]): DailyBreakdownRow[] {
  const grouped = new Map<string, DailyBreakdownRow & { _sessionIds: Set<string> }>();

  for (const session of sessions) {
    const sessionSeen = new Set<string>();

    for (const request of session.requests) {
      const key = [
        request.date,
        request.source,
        request.subharness,
        request.model,
        request.effort,
      ].join("\u0000");
      const row =
        grouped.get(key) ??
        ({
          _sessionIds: new Set<string>(),
          activeSeconds: 0,
          cached: 0,
          date: request.date,
          effort: request.effort,
          harness: request.source,
          input: 0,
          model: request.model,
          output: 0,
          reasoning: request.reasoning,
          requests: 0,
          sessions: 0,
          subharness: request.subharness,
        } satisfies DailyBreakdownRow & { _sessionIds: Set<string> });

      row.cached += request.cacheRead;
      row.input += request.input;
      row.output += request.output;
      row.reasoning += request.reasoning;
      row.requests += 1;
      row._sessionIds.add(session.sessionId);

      const sessionKey = `${key}\u0000${session.sessionId}`;
      if (!sessionSeen.has(sessionKey)) {
        row.activeSeconds +=
          session.dayStateActiveSeconds[request.date]?.[stateKey(request.model, request.effort)] ??
          0;
        sessionSeen.add(sessionKey);
      }

      grouped.set(key, row);
    }
  }

  return [...grouped.values()]
    .map(({ _sessionIds, ...row }) => ({ ...row, sessions: _sessionIds.size }))
    .sort((a, b) =>
      compareRows(
        [b.date, b.harness, b.subharness, b.model, b.effort],
        [a.date, a.harness, a.subharness, a.model, a.effort],
      ),
    );
}

export function filterSessionsByModel(
  sessions: ParsedSession[],
  predicate: (model: string) => boolean,
): ParsedSession[] {
  const filtered: ParsedSession[] = [];

  for (const session of sessions) {
    const requests = session.requests.filter((request) => predicate(request.model));
    const modelTokens = filterMap(session.modelTokens, predicate);
    if (requests.length === 0 && Object.keys(modelTokens).length === 0) {
      continue;
    }

    const models: Record<string, number> = {};
    const efforts: Record<string, number> = {};
    for (const request of requests) {
      models[request.model] = (models[request.model] ?? 0) + 1;
      efforts[request.effort] = (efforts[request.effort] ?? 0) + 1;
    }

    const modelActiveSeconds = filterMap(session.modelActiveSeconds, predicate);
    const stateActiveSeconds = filterStateMap(session.stateActiveSeconds, predicate);
    const dayModelActiveSeconds = mapValues(session.dayModelActiveSeconds, (value) =>
      filterMap(value, predicate),
    );
    const dayStateActiveSeconds = mapValues(session.dayStateActiveSeconds, (value) =>
      filterStateMap(value, predicate),
    );
    const tokens = sumModelTokens(modelTokens);
    const activeSeconds =
      sumValues(modelActiveSeconds) ||
      Math.max(60, sumValues(stateActiveSeconds)) ||
      session.activeSeconds;

    filtered.push({
      ...session,
      activeSeconds,
      assistantTurns: Math.min(session.assistantTurns, requests.length),
      dayModelActiveSeconds,
      dayStateActiveSeconds,
      efforts,
      modelActiveSeconds,
      modelTokens,
      models,
      requestCount: requests.length,
      requests,
      stateActiveSeconds,
      tokens,
      userTurns: session.userTurns,
    });
  }

  return filtered;
}

export function summarizeRequestContexts(requests: SessionRequest[]): RequestContextSummary {
  const values = requests.map((request) => request.contextSize).filter((value) => value >= 0);
  if (values.length === 0) {
    return {};
  }

  const ordered = [...requests].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const first = ordered[0]?.contextSize;
  const final = ordered.at(-1)?.contextSize;

  return {
    average: mean(values),
    final,
    first,
    growth: first !== undefined && final !== undefined ? final - first : undefined,
    median: percentile(values, 0.5),
    peak: Math.max(...values),
  };
}

export function summarizeRequestCache(
  requests: SessionRequest[],
  pricing: Record<string, PricingInfo>,
): RequestCacheSummary {
  if (requests.length === 0) {
    return {};
  }

  const ratios = requests.map((request) => request.cacheReadRatio);
  const cacheReads = requests.map((request) => request.cacheRead);
  const uncached = requests.map((request) => request.uncachedInput);
  const weighted = requests
    .map((request) => weightedInputEquivalent(request, pricing))
    .filter((value): value is number => value !== undefined);

  return {
    cacheReadPerRequest: mean(cacheReads),
    cacheReadRatio: mean(ratios),
    uncachedInputPerRequest: mean(uncached),
    weightedInputEqPerRequest: mean(weighted),
  };
}

export function sessionDistributions(sessions: ParsedSession[]): Record<string, number[]> {
  const out: Record<string, number[]> = {
    cachedInputPerActiveMinute: [],
    contextSizePerRequest: [],
    freshInputPerActiveMinute: [],
    outputPerActiveMinute: [],
    tokensPerActiveMinute: [],
    totalTokensPerTurn: [],
  };

  for (const session of sessions) {
    const minutes = Math.max(session.activeSeconds / 60, 1 / 60);
    out.tokensPerActiveMinute.push(session.tokens.total / minutes);
    out.freshInputPerActiveMinute.push(session.tokens.input / minutes);
    out.cachedInputPerActiveMinute.push(session.tokens.cached / minutes);
    out.outputPerActiveMinute.push(session.tokens.output / minutes);

    for (const request of session.requests) {
      out.contextSizePerRequest.push(request.contextSize);
      out.totalTokensPerTurn.push(request.total);
    }
  }

  return out;
}

export function summarizeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return {};
  }

  return {
    max: Math.max(...values),
    mean: mean(values),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
  };
}

export type PricingInfo = {
  cacheRead?: number;
  cacheWrite?: number;
  completion?: number;
  prompt?: number;
};

export function estimateCost(
  modelName: string,
  tokenInfo: ModelTokenUsage | TokenUsage,
  pricing: Record<string, PricingInfo>,
): number | undefined {
  const modelId = MODEL_ALIASES[modelName] ?? modelName;
  const rates = pricing[modelId];
  if (!rates) {
    return undefined;
  }

  const prompt = rates.prompt ?? 0;
  const completion = rates.completion ?? 0;
  const cacheRead = rates.cacheRead ?? 0;
  const cacheWrite = rates.cacheWrite ?? prompt;
  const billableOutput =
    "billableOutput" in tokenInfo ? tokenInfo.billableOutput : tokenInfo.output;

  return (
    tokenInfo.input * prompt +
    tokenInfo.cached * cacheRead +
    tokenInfo.cacheWrite * cacheWrite +
    billableOutput * completion
  );
}

export function estimateStatsTotalCost(
  stats: ReportStats,
  pricing: Record<string, PricingInfo>,
): number | undefined {
  let total = 0;
  let found = false;

  for (const [model, tokenInfo] of Object.entries(stats.modelTokens)) {
    const value = estimateCost(model, tokenInfo, pricing);
    if (value === undefined) {
      continue;
    }
    found = true;
    total += value;
  }

  return found ? total : undefined;
}

export function isGptModel(model: string): boolean {
  return model.toLowerCase().includes("gpt");
}

export function attributionOverageRows(
  sessions: ParsedSession[],
): Array<{ active: number; attributed: number; sessionId: string; source: string }> {
  return sessions
    .map((session) => ({
      active: session.activeSeconds,
      attributed: sumValues(session.stateActiveSeconds),
      sessionId: session.sessionId,
      source: session.source,
    }))
    .filter((row) => row.attributed > row.active);
}

export function formatScopeTitle(scope: Scope, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  if (scope === "today") {
    return `Today · ${today}`;
  }
  if (scope === "7d") {
    return `Last 7 Days · since ${offsetIsoDay(now, 6)}`;
  }
  return `Last 30 Days · since ${offsetIsoDay(now, 29)}`;
}

export function formatFloat(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (value === 0) {
    return "$0.00";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

export function formatUsdPerMillion(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  const perMillion = value * 1_000_000;
  if (perMillion === 0) {
    return "$0/M";
  }
  if (perMillion < 0.01) {
    return `$${perMillion.toFixed(4)}/M`;
  }
  if (perMillion < 1) {
    return `$${perMillion.toFixed(3)}/M`;
  }
  return `$${perMillion.toFixed(2)}/M`;
}

export function topEntries(
  values: Record<string, number>,
  limit: number,
): Array<{ key: string; value: number }> {
  return Object.entries(values)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }));
}

export function percentRows(
  values: Record<string, number>,
  limit: number,
): Array<{ key: string; label: string; pct: number }> {
  const total = sumValues(values);
  if (total <= 0) {
    return [];
  }

  return topEntries(values, limit).map(({ key, value }) => {
    const pct = (value / total) * 100;
    return { key, label: `${pct.toFixed(0)}%`, pct };
  });
}

export function modelRows(
  stats: ReportStats,
  pricing: Record<string, PricingInfo>,
  limit: number,
): Array<{
  cost: string;
  inputRate: string;
  key: string;
  outputRate: string;
  pct: number;
  tokenInfo: ModelTokenUsage;
}> {
  const total = sumValues(stats.modelUsage);
  if (total <= 0) {
    return [];
  }

  return topEntries(stats.modelUsage, limit).map(({ key, value }) => {
    const tokenInfo =
      stats.modelTokens[key] ??
      ({
        billableOutput: 0,
        cacheWrite: 0,
        cached: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        total: 0,
      } satisfies ModelTokenUsage);
    const modelId = MODEL_ALIASES[key] ?? key;
    const rates = pricing[modelId] ?? {};
    return {
      cost: formatUsd(estimateCost(key, tokenInfo, pricing)),
      inputRate: formatUsdPerMillion(rates.prompt),
      key,
      outputRate: formatUsdPerMillion(rates.completion),
      pct: (value / total) * 100,
      tokenInfo,
    };
  });
}

export const MODEL_ALIASES: Record<string, string> = {
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  "claude-opus-4-6": "anthropic/claude-opus-4.6",
  "claude-opus-4-7": "anthropic/claude-opus-4.7",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "deepseek-v4-flash": "deepseek/deepseek-v4-flash",
  "deepseek-v4-flash-free": "deepseek/deepseek-v4-flash:free",
  "gpt-5": "openai/gpt-5",
  "gpt-5.3-codex": "openai/gpt-5.3-codex",
  "gpt-5.4": "openai/gpt-5.4",
  "gpt-5.4-mini": "openai/gpt-5.4-mini",
  "gpt-5.5": "openai/gpt-5.5",
  "gpt-5-mini": "openai/gpt-5-mini",
};

function makeSection(title: string, sessions: ParsedSession[], tone: string): SourceSection {
  return { sessions, stats: aggregateSessions(sessions), title, tone };
}

function offsetIsoDay(now: Date, days: number): string {
  const value = new Date(now);
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function mergeTokens(target: TokenUsage, source: TokenUsage): void {
  target.cacheWrite += source.cacheWrite;
  target.cached += source.cached;
  target.input += source.input;
  target.output += source.output;
  target.reasoning += source.reasoning;
  target.total += source.total;
}

function zeroTokens(): TokenUsage {
  return { cacheWrite: 0, cached: 0, input: 0, output: 0, reasoning: 0, total: 0 };
}

function sumValues(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function sumModelTokens(modelTokens: Record<string, ModelTokenUsage>): TokenUsage {
  const total = zeroTokens();
  for (const value of Object.values(modelTokens)) {
    mergeTokens(total, value);
  }
  return total;
}

function filterMap<T extends number | ModelTokenUsage>(
  values: Record<string, T>,
  predicate: (key: string) => boolean,
): Record<string, T> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => predicate(key)));
}

function filterStateMap(
  values: Record<string, number>,
  predicate: (model: string) => boolean,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => predicate(splitStateKey(key).model)),
  );
}

function mapValues(
  values: Record<string, Record<string, number>>,
  mapper: (value: Record<string, number>) => Record<string, number>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, mapper(value)] as const)
      .filter(([, value]) => Object.keys(value).length > 0),
  );
}

function stateKey(model: string, effort: string): string {
  return `${model}::${effort}`;
}

function weightedInputEquivalent(
  request: SessionRequest,
  pricing: Record<string, PricingInfo>,
): number | undefined {
  const rates = pricing[MODEL_ALIASES[request.model] ?? request.model];
  if (!rates?.prompt) {
    return undefined;
  }

  const prompt = rates.prompt;
  const cacheReadWeight = rates.cacheRead === undefined ? 1 : rates.cacheRead / prompt;
  const cacheWriteWeight = rates.cacheWrite === undefined ? 1 : rates.cacheWrite / prompt;

  return (
    request.input + request.cacheRead * cacheReadWeight + request.cacheWrite * cacheWriteWeight
  );
}

function compareRows(left: string[], right: string[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) {
      continue;
    }
    return left[index].localeCompare(right[index]);
  }
  return 0;
}
