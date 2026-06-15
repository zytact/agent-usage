import type { ParsedSession, SessionRequest, TokenUsage } from "./domain.js";
import { mean, percentile, scopeStart, splitStateKey, stddev, type Scope } from "./report-core.js";

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

export type DailyUsageRow = {
  activeSeconds: number;
  cost?: number;
  date: string;
  requestCount: number;
  tokens: number;
};

export type DailyUsageSummary = {
  avgCost?: number;
  avgTokens?: number;
  costStddev?: number;
  rows: DailyUsageRow[];
  tokenStddev?: number;
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

export type RequestDistributionRow = {
  label: string;
  summary: DistributionSummary;
};

export type RequestSummaryData = {
  cache: RequestCacheSummary;
  context: RequestContextSummary;
  distributions: ReturnType<typeof sessionDistributions>;
  hours: number;
  requests: SessionRequest[];
  rows: RequestDistributionRow[];
};

export type RequestSummarySource = {
  requests: SessionRequest[];
  sessions?: ParsedSession[];
  distributions?: ReturnType<typeof sessionDistributions>;
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
  dailyUsage: DailyUsageSummary;
  generatedAt: Date;
  gptOnly: SourceSection;
  gptOnlyRequestSummary: RequestSummarySource;
  includeClaude: boolean;
  requestSummary: RequestSummarySource;
  requestSummarySessions: ParsedSession[];
  scope: Scope;
  scopeTitle: string;
  sections: SourceSection[];
  sourceCount: number;
};

const SOURCE_TONES = {
  claude: "oklch(0.72 0.1 50)",
  codex: "oklch(0.681 0.132 258.4)",
  combined: "oklch(0.681 0.132 258.4)",
  gptOnly: "oklch(0.68 0.11 165)",
  opencode: "oklch(0.64 0.13 300)",
  pi: "oklch(0.7 0.11 150)",
  t3code: "oklch(0.75 0.15 70)",
  other: "oklch(0.72 0.09 210)",
} as const;

function filterSessionsByScope(
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
    mergeModelTokens(stats.modelTokens, session.modelTokens);
    mergeDayStats(stats.days, session.start, session.activeSeconds, session.requestCount);
  }

  return stats;
}

export function buildReport(
  sessions: ParsedSession[],
  scope: Scope,
  includeClaude: boolean,
  now: Date,
  pricing: Record<string, PricingInfo> = {},
): BuiltReport {
  const filtered = filterSessionsByScope(sessions, scope, now);
  const buckets = {
    claude: [] as ParsedSession[],
    codex: [] as ParsedSession[],
    codexOther: [] as ParsedSession[],
    codexT3: [] as ParsedSession[],
    opencode: [] as ParsedSession[],
    opencodeOther: [] as ParsedSession[],
    opencodeT3: [] as ParsedSession[],
    pi: [] as ParsedSession[],
  };
  const gptOnlyStats = createEmptyStats();
  const gptOnlyRequests: SessionRequest[] = [];
  const gptOnlyDistributions = emptySessionDistributions();

  for (const session of filtered) {
    addSectionBucket(session, buckets);
    const gptOnly = buildModelFilteredSummary(session, isGptModel);
    if (!gptOnly) {
      continue;
    }
    mergeFilteredSessionStats(gptOnlyStats, gptOnly, session);
    gptOnlyRequests.push(...gptOnly.requests);
    addSessionDistributions(
      gptOnlyDistributions,
      gptOnly.activeSeconds,
      gptOnly.tokens,
      gptOnly.requests,
    );
  }

  const sections: SourceSection[] = [
    makeSection("Combined", filtered, SOURCE_TONES.combined),
    { sessions: [], stats: gptOnlyStats, title: "GPT-only", tone: SOURCE_TONES.gptOnly },
    makeSection("Codex", buckets.codex, SOURCE_TONES.codex),
    makeSection("Codex via T3 Code", buckets.codexT3, SOURCE_TONES.t3code),
    makeSection("Codex other", buckets.codexOther, SOURCE_TONES.other),
    makeSection("opencode", buckets.opencode, SOURCE_TONES.opencode),
    makeSection("opencode via T3 Code", buckets.opencodeT3, SOURCE_TONES.t3code),
    makeSection("opencode other", buckets.opencodeOther, SOURCE_TONES.other),
  ];

  if (includeClaude) {
    sections.push(makeSection("Claude Code", buckets.claude, SOURCE_TONES.claude));
  }

  sections.push(makeSection("Pi", buckets.pi, SOURCE_TONES.pi));

  return {
    attributionOverages: attributionOverageRows(filtered),
    combined: sections[0],
    dailyRows: groupedDailyModelBreakdown(filtered),
    dailyUsage: buildDailyUsageSummary(filtered, scope, now, pricing),
    generatedAt: now,
    gptOnly: sections[1],
    gptOnlyRequestSummary: {
      distributions: gptOnlyDistributions,
      requests: gptOnlyRequests,
    },
    includeClaude,
    requestSummary: {
      requests: filtered.flatMap((session) => session.requests),
      sessions: filtered,
    },
    requestSummarySessions: filtered,
    scope,
    scopeTitle: formatScopeTitle(scope, now),
    sections,
    sourceCount: 3 + (includeClaude ? 1 : 0),
  };
}

function buildDailyUsageSummary(
  sessions: ParsedSession[],
  scope: Scope,
  now: Date,
  pricing: Record<string, PricingInfo>,
): DailyUsageSummary {
  const rows: DailyUsageRow[] = scopeDays(scope, now).map((date) => ({
    activeSeconds: 0,
    cost: undefined,
    date,
    requestCount: 0,
    tokens: 0,
  }));
  const byDate = new Map(rows.map((row) => [row.date, row]));

  for (const session of sessions) {
    for (const [date, day] of Object.entries(session.dayModelActiveSeconds)) {
      const row = byDate.get(date);
      if (!row) {
        continue;
      }
      row.activeSeconds += sumValues(day);
    }

    for (const request of session.requests) {
      const row = byDate.get(request.date);
      if (!row) {
        continue;
      }
      row.requestCount += 1;
      row.tokens += request.total;
      row.cost = (row.cost ?? 0) + estimateRequestCost(request, pricing);
    }
  }

  const tokenValues = rows.map((row) => row.tokens);
  const costValues = rows.map((row) => row.cost ?? 0);

  return {
    avgCost: mean(costValues),
    avgTokens: mean(tokenValues),
    costStddev: stddev(costValues),
    rows,
    tokenStddev: stddev(tokenValues),
  };
}

function groupedDailyModelBreakdown(sessions: ParsedSession[]): DailyBreakdownRow[] {
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

type FilteredSessionSummary = {
  activeSeconds: number;
  efforts: Record<string, number>;
  modelActiveSeconds: Record<string, number>;
  modelTokens: ParsedSession["modelTokens"];
  models: Record<string, number>;
  requests: SessionRequest[];
  stateActiveSeconds: Record<string, number>;
  tokens: TokenUsage;
};

function addSectionBucket(
  session: ParsedSession,
  buckets: {
    claude: ParsedSession[];
    codex: ParsedSession[];
    codexOther: ParsedSession[];
    codexT3: ParsedSession[];
    opencode: ParsedSession[];
    opencodeOther: ParsedSession[];
    opencodeT3: ParsedSession[];
    pi: ParsedSession[];
  },
): void {
  switch (session.source) {
    case "codex":
      buckets.codex.push(session);
      (session.originator === "t3code_desktop" ? buckets.codexT3 : buckets.codexOther).push(
        session,
      );
      return;
    case "opencode":
      buckets.opencode.push(session);
      (session.originator === "t3code_desktop" ? buckets.opencodeT3 : buckets.opencodeOther).push(
        session,
      );
      return;
    case "claude":
      buckets.claude.push(session);
      return;
    case "pi":
      buckets.pi.push(session);
      return;
  }
}

function buildModelFilteredSummary(
  session: ParsedSession,
  predicate: (model: string) => boolean,
): FilteredSessionSummary | undefined {
  const requests = session.requests.filter((request) => predicate(request.model));
  const modelTokens = filterMap(session.modelTokens, predicate);
  if (requests.length === 0 && Object.keys(modelTokens).length === 0) {
    return undefined;
  }

  const models: Record<string, number> = {};
  const efforts: Record<string, number> = {};
  for (const request of requests) {
    models[request.model] = (models[request.model] ?? 0) + 1;
    efforts[request.effort] = (efforts[request.effort] ?? 0) + 1;
  }

  const modelActiveSeconds = filterMap(session.modelActiveSeconds, predicate);
  const stateActiveSeconds = filterStateMap(session.stateActiveSeconds, predicate);
  const tokens = sumModelTokens(modelTokens);
  const activeSeconds =
    sumValues(modelActiveSeconds) ||
    Math.max(60, sumValues(stateActiveSeconds)) ||
    session.activeSeconds;

  return {
    activeSeconds,
    efforts,
    modelActiveSeconds,
    modelTokens,
    models,
    requests,
    stateActiveSeconds,
    tokens,
  };
}

function mergeFilteredSessionStats(
  stats: ReportStats,
  filtered: FilteredSessionSummary,
  session: ParsedSession,
): void {
  stats.activeSeconds += filtered.activeSeconds;
  stats.assistantTurns += Math.min(session.assistantTurns, filtered.requests.length);
  stats.requestCount += filtered.requests.length;
  stats.sessionCount += 1;
  stats.userTurns += session.userTurns;
  stats.repos[session.repo] = (stats.repos[session.repo] ?? 0) + filtered.activeSeconds;
  mergeCounts(stats.languages, session.languages);
  mergeCounts(stats.efforts, filtered.efforts);
  mergeCounts(stats.modelUsage, filtered.models);
  mergeCounts(stats.modelActiveSeconds, filtered.modelActiveSeconds);
  mergeTokens(stats.tokens, filtered.tokens);
  mergeModelTokens(stats.modelTokens, filtered.modelTokens);
  mergeDayStats(stats.days, session.start, filtered.activeSeconds, filtered.requests.length);
}

function mergeModelTokens(
  target: Record<string, ModelTokenUsage>,
  source: Record<string, ModelTokenUsage>,
): void {
  for (const [model, usage] of Object.entries(source)) {
    const bucket = (target[model] ??= { ...zeroTokens(), billableOutput: 0 });
    bucket.billableOutput += usage.billableOutput;
    bucket.cacheWrite += usage.cacheWrite;
    bucket.cached += usage.cached;
    bucket.input += usage.input;
    bucket.output += usage.output;
    bucket.reasoning += usage.reasoning;
    bucket.total += usage.total;
  }
}

function mergeDayStats(
  days: ReportStats["days"],
  start: Date,
  activeSeconds: number,
  requestCount: number,
): void {
  const dayKey = start.toISOString().slice(0, 10);
  const day = (days[dayKey] ??= {
    activeSeconds: 0,
    requestCount: 0,
    sessionCount: 0,
  });
  day.activeSeconds += activeSeconds;
  day.requestCount += requestCount;
  day.sessionCount += 1;
}

function summarizeRequestContexts(requests: SessionRequest[]): RequestContextSummary {
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

function sessionDistributions(sessions: ParsedSession[]): Record<string, number[]> {
  const out = emptySessionDistributions();

  for (const session of sessions) {
    addSessionDistributions(out, session.activeSeconds, session.tokens, session.requests);
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

export function buildRequestSummaryData(
  source: RequestSummarySource,
  stats: ReportStats,
  pricing: Record<string, PricingInfo>,
): RequestSummaryData {
  const requests = source.requests;
  const distributions = source.distributions ?? sessionDistributions(source.sessions ?? []);
  const distributionInputs: Array<[string, number[]]> = [
    ["Tokens / active minute", distributions.tokensPerActiveMinute],
    ["Fresh input / active minute", distributions.freshInputPerActiveMinute],
    ["Cached input / active minute", distributions.cachedInputPerActiveMinute],
    ["Output / active minute", distributions.outputPerActiveMinute],
    ["Total tokens / turn", distributions.totalTokensPerTurn],
    ["Context size / request", distributions.contextSizePerRequest],
  ];
  const rows: RequestDistributionRow[] = distributionInputs.map(([label, values]) => ({
    label,
    summary: summarizeDistribution(values),
  }));

  return {
    cache: summarizeRequestCache(requests, pricing),
    context: summarizeRequestContexts(requests),
    distributions,
    hours: Math.max(stats.activeSeconds / 3600, 1 / 3600),
    requests,
    rows,
  };
}

export type PricingInfo = {
  cacheRead?: number;
  cacheWrite?: number;
  completion?: number;
  prompt?: number;
};

export type CostBreakdown = {
  cacheWrite: number;
  cached: number;
  input: number;
  output: number;
  total: number;
};

export function resolveModelId(modelName: string): string {
  return MODEL_ALIASES[modelName] ?? modelName;
}

export function estimateCostBreakdown(
  modelName: string,
  tokenInfo: ModelTokenUsage | TokenUsage,
  pricing: Record<string, PricingInfo>,
): CostBreakdown | undefined {
  const rates = pricing[resolveModelId(modelName)];
  if (!rates) {
    return undefined;
  }

  const prompt = rates.prompt ?? 0;
  const completion = rates.completion ?? 0;
  const cacheRead = rates.cacheRead ?? 0;
  const cacheWrite = rates.cacheWrite ?? prompt;
  const billableOutput =
    "billableOutput" in tokenInfo ? tokenInfo.billableOutput : tokenInfo.output;
  const input = tokenInfo.input * prompt;
  const cached = tokenInfo.cached * cacheRead;
  const write = tokenInfo.cacheWrite * cacheWrite;
  const output = billableOutput * completion;

  return {
    cacheWrite: write,
    cached,
    input,
    output,
    total: input + cached + write + output,
  };
}

export function estimateCost(
  modelName: string,
  tokenInfo: ModelTokenUsage | TokenUsage,
  pricing: Record<string, PricingInfo>,
): number | undefined {
  return estimateCostBreakdown(modelName, tokenInfo, pricing)?.total;
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

function estimateRequestCost(
  request: Pick<
    SessionRequest,
    "cacheRead" | "cacheWrite" | "input" | "model" | "output" | "reasoning"
  >,
  pricing: Record<string, PricingInfo> = {},
): number {
  return (
    estimateCost(
      request.model,
      {
        billableOutput: request.output + request.reasoning,
        cacheWrite: request.cacheWrite,
        cached: request.cacheRead,
        input: request.input,
        output: request.output,
        reasoning: request.reasoning,
        total:
          request.input +
          request.cacheRead +
          request.cacheWrite +
          request.output +
          request.reasoning,
      },
      pricing,
    ) ?? 0
  );
}

function isGptModel(model: string): boolean {
  return model.toLowerCase().includes("gpt");
}

function attributionOverageRows(
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

function formatScopeTitle(scope: Scope, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  if (scope === "today") {
    return `Today · ${today}`;
  }
  if (scope === "1d") {
    return `Last 24 Hours · since ${formatScopeMoment(new Date(now.getTime() - 24 * 60 * 60 * 1000))}`;
  }
  if (scope === "7d") {
    return `Last 7 Days · since ${offsetIsoDay(now, 6)}`;
  }
  return `Last 30 Days · since ${offsetIsoDay(now, 29)}`;
}

function formatScopeMoment(value: Date): string {
  return `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)} UTC`;
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
    const modelId = resolveModelId(key);
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

const MODEL_ALIASES: Record<string, string> = {
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

function createEmptyStats(): ReportStats {
  return {
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
}

function emptySessionDistributions(): ReturnType<typeof sessionDistributions> {
  return {
    cachedInputPerActiveMinute: [],
    contextSizePerRequest: [],
    freshInputPerActiveMinute: [],
    outputPerActiveMinute: [],
    tokensPerActiveMinute: [],
    totalTokensPerTurn: [],
  };
}

function addSessionDistributions(
  out: ReturnType<typeof sessionDistributions>,
  activeSeconds: number,
  tokens: TokenUsage,
  requests: SessionRequest[],
): void {
  const minutes = Math.max(activeSeconds / 60, 1 / 60);
  out.tokensPerActiveMinute.push(tokens.total / minutes);
  out.freshInputPerActiveMinute.push(tokens.input / minutes);
  out.cachedInputPerActiveMinute.push(tokens.cached / minutes);
  out.outputPerActiveMinute.push(tokens.output / minutes);

  for (const request of requests) {
    out.contextSizePerRequest.push(request.contextSize);
    out.totalTokensPerTurn.push(request.total);
  }
}

function offsetIsoDay(now: Date, days: number): string {
  const value = new Date(now);
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

function scopeDays(scope: Scope, now: Date): string[] {
  if (scope === "1d") {
    return [offsetIsoDay(now, 1), offsetIsoDay(now, 0)];
  }
  if (scope === "today") {
    return [offsetIsoDay(now, 0)];
  }

  const days = scope === "7d" ? 7 : 30;
  return Array.from({ length: days }, (_, index) => offsetIsoDay(now, days - index - 1));
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

function stateKey(model: string, effort: string): string {
  return `${model}::${effort}`;
}

function weightedInputEquivalent(
  request: SessionRequest,
  pricing: Record<string, PricingInfo>,
): number | undefined {
  const rates = pricing[resolveModelId(request.model)];
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

export function estimateWeightedInputEquivalent(
  request: SessionRequest,
  pricing: Record<string, PricingInfo>,
): number | undefined {
  return weightedInputEquivalent(request, pricing);
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
