import type {
  ParsedSession,
  SessionRequest,
  SourceId,
  TelemetryAvailability,
  TokenUsage,
} from "./domain.js";
import { originatorLabel } from "./ingest-shared.js";
import {
  allocateStateTime,
  calendarDate,
  collapseDayStateSeconds,
  collapseStateSeconds,
  coefficientOfVariation,
  mean,
  percentile,
  scopeStart,
  splitStateKey,
  type Scope,
} from "./report-core.js";

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
  reasoningAvailability: TelemetryAvailability;
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
  activeDayAvgCost?: number;
  activeDayAvgTokens?: number;
  avgCost?: number;
  avgTokens?: number;
  costMedian?: number;
  costP90?: number;
  costVolatility?: number;
  rows: DailyUsageRow[];
  tokenMedian?: number;
  tokenP90?: number;
  tokenVolatility?: number;
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

export type EffortBreakdownRow = {
  activeSeconds: number;
  activeSecondsPerRequest?: number;
  cachedPerRequest: number;
  contextPerRequest?: number;
  costBreakdownPerRequest?: CostBreakdown;
  costPerActiveMinute?: number;
  costPerRequest?: number;
  costPerRequestUplift?: number;
  costPerActiveMinuteUplift?: number;
  effort: string;
  inputPerRequest: number;
  outputPerRequest: number;
  outputPerRequestUplift?: number;
  reasoningAvailability: TelemetryAvailability;
  reasoningPerRequest?: number;
  reasoningPerRequestUplift?: number;
  requests: number;
  tokensPerRequest: number;
  tokensPerRequestUplift?: number;
  contextPerRequestUplift?: number;
};

export type ModelEffortBreakdown = {
  effortRows: EffortBreakdownRow[];
  model: string;
};

export type WorkflowModelAttribution = {
  agents: number;
  effort: string;
  model: string;
};

export type MixedWorkflowUsage = {
  activeSeconds: number;
  requests: number;
  tokenInfo: ModelTokenUsage;
};

export type EffortMetricCell = {
  kind: "duration" | "tokens" | "usd";
  label: string;
  note: string;
  value: number | undefined;
};

type EffortAggregationBucket = {
  activeSeconds: number;
  contextCount: number;
  contextTotal: number;
  costBreakdown?: CostBreakdown;
  reasoningRequestCount: number;
  requestCount: number;
  tokenInfo: ModelTokenUsage;
};

export type SourceSection = {
  kind: "combined" | "gptOnly" | "originator" | "primary";
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
  selectedSources: SourceId[];
  showOriginators: boolean;
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
  return sessions
    .map((session) => clipSessionToScope(session, start))
    .filter((session): session is ParsedSession => session !== undefined);
}

function clipSessionToScope(session: ParsedSession, start: Date): ParsedSession | undefined {
  if (session.end < start) {
    return undefined;
  }
  if (session.start >= start) {
    return session;
  }

  const requests = session.requests.filter((request) => request.ts >= start);
  if (requests.length === 0) {
    return undefined;
  }

  const allocated = allocateStateTime(
    requests.map((request) => ({
      effort: request.effort,
      model: request.model,
      ts: request.ts,
    })),
  );
  const modelTokens: ParsedSession["modelTokens"] = {};
  const models: Record<string, number> = {};
  const efforts: Record<string, number> = {};

  for (const request of requests) {
    const bucket = (modelTokens[request.model] ??= {
      ...zeroTokens(),
      billableOutput: 0,
    });
    addRequestTokens(bucket, request);
    models[request.model] = (models[request.model] ?? 0) + 1;
    efforts[request.effort] = (efforts[request.effort] ?? 0) + 1;
  }

  const ratio = requests.length / Math.max(session.requests.length, 1);
  return {
    ...session,
    activeSeconds: allocated.totalSeconds,
    assistantTurns: Math.round(session.assistantTurns * ratio),
    cacheWriteAvailability: telemetryAvailability(requests, "cacheWriteAvailability"),
    dayModelActiveSeconds: collapseDayStateSeconds(allocated.byDayStateSeconds),
    dayStateActiveSeconds: allocated.byDayStateSeconds,
    efforts,
    modelActiveSeconds: collapseStateSeconds(allocated.byStateSeconds),
    modelTokens,
    models,
    reasoningAvailability: telemetryAvailability(requests, "reasoningAvailability"),
    requestCount: requests.length,
    requests,
    start: new Date(Math.max(session.start.getTime(), start.getTime())),
    stateActiveSeconds: allocated.byStateSeconds,
    tokens: sumModelTokens(modelTokens),
    userTurns: Math.round(session.userTurns * ratio),
  };
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
    mergeSessionDays(stats.days, session);
  }

  return stats;
}

export function buildReport(
  sessions: ParsedSession[],
  scope: Scope,
  selectedSources: SourceId[],
  now: Date,
  pricing: Record<string, PricingInfo> = {},
  showOriginators = false,
): BuiltReport {
  const filtered = filterSessionsByScope(sessions, scope, now);
  const buckets = bucketSessionsBySource(filtered);
  const gptOnly = buildGptOnlySummary(filtered);
  const sections = buildSourceSections(
    filtered,
    buckets,
    gptOnly.stats,
    selectedSources,
    showOriginators,
  );

  return {
    attributionOverages: attributionOverageRows(filtered),
    combined: sections[0],
    dailyRows: groupedDailyModelBreakdown(filtered),
    dailyUsage: buildDailyUsageSummary(filtered, scope, now, pricing),
    generatedAt: now,
    gptOnly: sections[1],
    gptOnlyRequestSummary: {
      distributions: gptOnly.distributions,
      requests: gptOnly.requests,
    },
    selectedSources,
    requestSummary: {
      requests: filtered.flatMap((session) => session.requests),
      sessions: filtered,
    },
    requestSummarySessions: filtered,
    scope,
    scopeTitle: formatScopeTitle(scope, now),
    sections,
    showOriginators,
    sourceCount: selectedSources.length,
  };
}

type SourceBuckets = Record<SourceId, ParsedSession[]>;

function bucketSessionsBySource(sessions: ParsedSession[]): SourceBuckets {
  const buckets: SourceBuckets = {
    claude: [],
    codex: [],
    opencode: [],
    pi: [],
  };

  for (const session of sessions) {
    addSectionBucket(session, buckets);
  }

  return buckets;
}

function buildGptOnlySummary(sessions: ParsedSession[]): {
  distributions: ReturnType<typeof emptySessionDistributions>;
  requests: SessionRequest[];
  stats: ReportStats;
} {
  const stats = createEmptyStats();
  const requests: SessionRequest[] = [];
  const distributions = emptySessionDistributions();

  for (const session of sessions) {
    const gptOnly = buildModelFilteredSummary(session, isGptModel);
    if (!gptOnly) {
      continue;
    }
    mergeFilteredSessionStats(stats, gptOnly, session);
    requests.push(...gptOnly.requests);
    addSessionDistributions(distributions, gptOnly.activeSeconds, gptOnly.tokens, gptOnly.requests);
  }

  return { distributions, requests, stats };
}

function buildSourceSections(
  filtered: ParsedSession[],
  buckets: SourceBuckets,
  gptOnlyStats: ReportStats,
  selectedSources: SourceId[],
  showOriginators: boolean,
): SourceSection[] {
  const selected = new Set(selectedSources);
  const sections: SourceSection[] = [
    makeSection("Combined", filtered, SOURCE_TONES.combined, "combined"),
    {
      kind: "gptOnly",
      sessions: [],
      stats: gptOnlyStats,
      title: "GPT-only",
      tone: SOURCE_TONES.gptOnly,
    },
  ];

  appendSelectedSourceSection(sections, selected, "codex", "Codex", buckets, showOriginators);
  appendSelectedSourceSection(sections, selected, "opencode", "opencode", buckets, showOriginators);
  appendSelectedSourceSection(
    sections,
    selected,
    "claude",
    "Claude Code",
    buckets,
    showOriginators,
  );
  appendSelectedSourceSection(sections, selected, "pi", "Pi", buckets, showOriginators);

  return sections;
}

function appendSelectedSourceSection(
  sections: SourceSection[],
  selected: Set<SourceId>,
  source: SourceId,
  title: string,
  buckets: SourceBuckets,
  showOriginators: boolean,
): void {
  if (!selected.has(source)) {
    return;
  }
  sections.push(makeSection(title, buckets[source], SOURCE_TONES[source], "primary"));
  if (showOriginators) {
    sections.push(...originatorSections(source, buckets[source]));
  }
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
  const activeRows = rows.filter(
    (row) => row.activeSeconds > 0 || row.requestCount > 0 || row.tokens > 0 || (row.cost ?? 0) > 0,
  );
  const activeTokenValues = activeRows.map((row) => row.tokens);
  const activeCostValues = activeRows.map((row) => row.cost ?? 0);

  return {
    activeDayAvgCost: mean(activeCostValues),
    activeDayAvgTokens: mean(activeTokenValues),
    avgCost: mean(costValues),
    avgTokens: mean(tokenValues),
    costMedian: percentile(activeCostValues, 0.5),
    costP90: percentile(activeCostValues, 0.9),
    costVolatility: coefficientOfVariation(activeCostValues),
    rows,
    tokenMedian: percentile(activeTokenValues, 0.5),
    tokenP90: percentile(activeTokenValues, 0.9),
    tokenVolatility: coefficientOfVariation(activeTokenValues),
  };
}

function groupedDailyModelBreakdown(sessions: ParsedSession[]): DailyBreakdownRow[] {
  const grouped = new Map<
    string,
    DailyBreakdownRow & { _reasoningKnown: number; _sessionIds: Set<string> }
  >();

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
          _reasoningKnown: 0,
          _sessionIds: new Set<string>(),
          activeSeconds: 0,
          cached: 0,
          date: request.date,
          effort: request.effort,
          harness: request.source,
          input: 0,
          model: request.model,
          output: 0,
          reasoning: 0,
          reasoningAvailability: "unknown",
          requests: 0,
          sessions: 0,
          subharness: request.subharness,
        } satisfies DailyBreakdownRow & {
          _reasoningKnown: number;
          _sessionIds: Set<string>;
        });

      row.cached += request.cacheRead;
      row.input += request.input;
      row.output += request.output;
      row.reasoning += request.reasoning;
      row._reasoningKnown += request.reasoningAvailability === "known" ? 1 : 0;
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
    .map(
      ({ _reasoningKnown, _sessionIds, ...row }): DailyBreakdownRow => ({
        ...row,
        reasoningAvailability:
          _reasoningKnown === 0
            ? "unknown"
            : _reasoningKnown === row.requests
              ? "known"
              : "partial",
        sessions: _sessionIds.size,
      }),
    )
    .sort((a, b) =>
      compareRows(
        [b.date, b.harness, b.subharness, b.model, b.effort],
        [a.date, a.harness, a.subharness, a.model, a.effort],
      ),
    );
}

type FilteredSessionSummary = {
  activeSeconds: number;
  dayModelActiveSeconds: ParsedSession["dayModelActiveSeconds"];
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
    opencode: ParsedSession[];
    pi: ParsedSession[];
  },
): void {
  switch (session.source) {
    case "codex":
      buckets.codex.push(session);
      return;
    case "opencode":
      buckets.opencode.push(session);
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
  const dayModelActiveSeconds = Object.fromEntries(
    Object.entries(session.dayModelActiveSeconds)
      .map(([date, values]) => [date, filterMap(values, predicate)] as const)
      .filter(([, values]) => Object.keys(values).length > 0),
  );
  const stateActiveSeconds = filterStateMap(session.stateActiveSeconds, predicate);
  const tokens = sumModelTokens(modelTokens);
  const activeSeconds =
    sumValues(modelActiveSeconds) ||
    Math.max(60, sumValues(stateActiveSeconds)) ||
    session.activeSeconds;

  return {
    activeSeconds,
    dayModelActiveSeconds,
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
  mergeDailyStats(stats.days, filtered.dayModelActiveSeconds, filtered.requests);
}

function mergeModelTokens(
  target: Record<string, ModelTokenUsage>,
  source: Record<string, ModelTokenUsage>,
): void {
  for (const [model, usage] of Object.entries(source)) {
    const bucket = (target[model] ??= { ...zeroTokens(), billableOutput: 0 });
    bucket.billableOutput += usage.billableOutput;
    bucket.cacheWrite += usage.cacheWrite;
    bucket.cacheWrite1h += usage.cacheWrite1h;
    bucket.cached += usage.cached;
    bucket.input += usage.input;
    bucket.output += usage.output;
    bucket.reasoning += usage.reasoning;
    bucket.total += usage.total;
  }
}

function mergeDailyStats(
  days: ReportStats["days"],
  dayModelActiveSeconds: ParsedSession["dayModelActiveSeconds"],
  requests: SessionRequest[],
): void {
  const requestCounts: Record<string, number> = {};
  for (const request of requests) {
    requestCounts[request.date] = (requestCounts[request.date] ?? 0) + 1;
  }

  const dates = new Set([...Object.keys(dayModelActiveSeconds), ...Object.keys(requestCounts)]);
  for (const date of dates) {
    const day = (days[date] ??= {
      activeSeconds: 0,
      requestCount: 0,
      sessionCount: 0,
    });
    day.activeSeconds += sumValues(dayModelActiveSeconds[date] ?? {});
    day.requestCount += requestCounts[date] ?? 0;
    day.sessionCount += 1;
  }
}

function mergeSessionDays(days: ReportStats["days"], session: ParsedSession): void {
  mergeDailyStats(days, session.dayModelActiveSeconds, session.requests);
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
  cacheWrite1h?: number;
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

export function resolveModelId(modelName: string, pricing: Record<string, PricingInfo>): string {
  if (Object.hasOwn(pricing, modelName)) {
    return modelName;
  }

  const candidates = pricingCandidates(pricing).get(normalizeModelId(modelName)) ?? [];
  const publisher = canonicalPublisher(modelName);
  const publisherMatch = publisher
    ? candidates.find((candidate) => candidate.startsWith(`${publisher}/`))
    : undefined;

  return publisherMatch ?? (candidates.length === 1 ? candidates[0] : modelName);
}

export function estimateCostBreakdown(
  modelName: string,
  tokenInfo: ModelTokenUsage | TokenUsage,
  pricing: Record<string, PricingInfo>,
): CostBreakdown | undefined {
  const rates = pricing[resolveModelId(modelName, pricing)];
  if (!rates) {
    return undefined;
  }

  const prompt = rates.prompt ?? 0;
  const completion = rates.completion ?? 0;
  const cacheRead = rates.cacheRead ?? 0;
  const cacheWrite = rates.cacheWrite ?? prompt;
  const cacheWrite1h = rates.cacheWrite1h ?? cacheWrite;
  const billableOutput =
    "billableOutput" in tokenInfo ? tokenInfo.billableOutput : tokenInfo.output;
  const input = tokenInfo.input * prompt;
  const cached = tokenInfo.cached * cacheRead;
  const oneHourWriteTokens = Math.min(tokenInfo.cacheWrite, tokenInfo.cacheWrite1h);
  const write =
    oneHourWriteTokens * cacheWrite1h + (tokenInfo.cacheWrite - oneHourWriteTokens) * cacheWrite;
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
    "cacheRead" | "cacheWrite" | "cacheWrite1h" | "input" | "model" | "output" | "reasoning"
  >,
  pricing: Record<string, PricingInfo> = {},
): number {
  return (
    estimateCost(
      request.model,
      {
        billableOutput: request.output + request.reasoning,
        cacheWrite: request.cacheWrite,
        cacheWrite1h: request.cacheWrite1h,
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
  const today = calendarDate(now);
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

function telemetryAvailability(
  requests: SessionRequest[],
  field: "cacheWriteAvailability" | "reasoningAvailability",
): TelemetryAvailability {
  const known = requests.filter((request) => request[field] === "known").length;
  return availabilityFromCounts(known, requests.length);
}

function availabilityFromCounts(known: number, total: number): TelemetryAvailability {
  if (known === 0) {
    return "unknown";
  }
  return known === total ? "known" : "partial";
}

export function cacheWriteAvailability(sessions: ParsedSession[]): TelemetryAvailability {
  return telemetryAvailability(
    sessions.flatMap((session) => session.requests),
    "cacheWriteAvailability",
  );
}

export function reasoningAvailability(sessions: ParsedSession[]): TelemetryAvailability {
  return telemetryAvailability(
    sessions.flatMap((session) => session.requests),
    "reasoningAvailability",
  );
}

export function modelTelemetryAvailability(section: SourceSection, model: string) {
  const requests = section.sessions.flatMap((session) =>
    session.requests.filter((request) => request.model === model),
  );
  return {
    cacheWrite: telemetryAvailability(requests, "cacheWriteAvailability"),
    reasoning: telemetryAvailability(requests, "reasoningAvailability"),
  };
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

export function effortMetricCells(row: EffortBreakdownRow): EffortMetricCell[] {
  return [
    {
      kind: "usd",
      label: "Cost/req",
      note: row.effort === "medium" ? "baseline" : formatUpliftNote(row.costPerRequestUplift),
      value: row.costPerRequest,
    },
    {
      kind: "usd",
      label: "Cost/active min",
      note: row.effort === "medium" ? "baseline" : formatUpliftNote(row.costPerActiveMinuteUplift),
      value: row.costPerActiveMinute,
    },
    {
      kind: "tokens",
      label: "Tok/req",
      note: row.effort === "medium" ? "baseline" : formatUpliftNote(row.tokensPerRequestUplift),
      value: row.tokensPerRequest,
    },
    {
      kind: "tokens",
      label: "Out/req",
      note: row.effort === "medium" ? "baseline" : formatUpliftNote(row.outputPerRequestUplift),
      value: row.outputPerRequest,
    },
    {
      kind: "tokens",
      label: "Reason/req",
      note:
        row.reasoningAvailability === "known"
          ? row.effort === "medium"
            ? "baseline"
            : formatUpliftNote(row.reasoningPerRequestUplift)
          : row.reasoningAvailability === "partial"
            ? "partially reported"
            : "not separately reported",
      value: row.reasoningPerRequest,
    },
    {
      kind: "tokens",
      label: "Ctx/req",
      note: row.effort === "medium" ? "baseline" : formatUpliftNote(row.contextPerRequestUplift),
      value: row.contextPerRequest,
    },
    { kind: "tokens", label: "Fresh/req", note: "uncached input", value: row.inputPerRequest },
    { kind: "tokens", label: "Cached/req", note: "cache read", value: row.cachedPerRequest },
    {
      kind: "duration",
      label: "Active/req",
      note: "inferred",
      value: row.activeSecondsPerRequest,
    },
  ];
}

export function effortCostMix(
  row: EffortBreakdownRow,
): Array<{ label: string; value: number | undefined }> {
  return [
    { label: "input", value: row.costBreakdownPerRequest?.input },
    { label: "cached", value: row.costBreakdownPerRequest?.cached },
    { label: "write", value: row.costBreakdownPerRequest?.cacheWrite },
    { label: "output+reason", value: row.costBreakdownPerRequest?.output },
  ];
}

export function modelRows(
  stats: ReportStats,
  pricing: Record<string, PricingInfo>,
  limit: number,
): Array<{
  activeSeconds: number;
  cost: string;
  inputRate: string;
  key: string;
  outputRate: string;
  pct: number;
  tokenInfo: ModelTokenUsage;
  tokensAttributed: boolean;
}> {
  const total = sumValues(stats.modelUsage);
  if (total <= 0) {
    return [];
  }

  return topEntries(stats.modelUsage, limit).map(({ key, value }) => {
    const attributedTokenInfo = stats.modelTokens[key];
    const tokenInfo =
      attributedTokenInfo ??
      ({
        billableOutput: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        cached: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        total: 0,
      } satisfies ModelTokenUsage);
    const modelId = resolveModelId(key, pricing);
    const rates = pricing[modelId] ?? {};
    return {
      activeSeconds: stats.modelActiveSeconds[key] ?? 0,
      cost: attributedTokenInfo ? formatUsd(estimateCost(key, tokenInfo, pricing)) : "n/a",
      inputRate: formatUsdPerMillion(rates.prompt),
      key,
      outputRate: formatUsdPerMillion(rates.completion),
      pct: (value / total) * 100,
      tokenInfo,
      tokensAttributed: attributedTokenInfo !== undefined,
    };
  });
}

export function modelRowsIncludingWorkflowModels(
  stats: ReportStats,
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  limit: number,
): ReturnType<typeof modelRows> {
  const top = modelRows(stats, pricing, limit);
  const workflowModels = new Set(workflowModelAttributions(sessions).map((row) => row.model));
  if (workflowModels.size === 0) return top;

  const included = new Set(top.map((row) => row.key));
  return [
    ...top,
    ...modelRows(stats, pricing, Object.keys(stats.modelUsage).length).filter(
      (row) => workflowModels.has(row.key) && !included.has(row.key),
    ),
  ];
}

export function mixedWorkflowUsage(sessions: ParsedSession[]): MixedWorkflowUsage | undefined {
  const stats = aggregateSessions(sessions);
  const tokenInfo = stats.modelTokens["mixed usage"];
  if (!tokenInfo) return undefined;
  return {
    activeSeconds: stats.modelActiveSeconds["mixed usage"] ?? 0,
    requests: sessions.reduce(
      (sum, session) =>
        sum + session.requests.filter((request) => request.model === "mixed usage").length,
      0,
    ),
    tokenInfo,
  };
}

export function workflowModelAttributions(sessions: ParsedSession[]): WorkflowModelAttribution[] {
  const grouped = new Map<string, WorkflowModelAttribution>();

  for (const session of sessions) {
    if (!session.requests.some((request) => request.model === "mixed usage")) continue;
    for (const agent of session.workflowAgentUsage ?? []) {
      const key = `${agent.model}\u0000${agent.effort}`;
      const row = grouped.get(key) ?? { agents: 0, effort: agent.effort, model: agent.model };
      row.agents += 1;
      grouped.set(key, row);
    }
  }

  return [...grouped.values()].sort(
    (a, b) => b.agents - a.agents || a.model.localeCompare(b.model),
  );
}

export function attributedModelTokenTotals(sessions: ParsedSession[]): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const session of sessions) {
    for (const [model, tokens] of Object.entries(session.modelTokens)) {
      if (model !== "mixed usage") {
        totals[model] = (totals[model] ?? 0) + tokens.total;
      }
    }
    if (!session.requests.some((request) => request.model === "mixed usage")) continue;
    for (const agent of session.workflowAgentUsage ?? []) {
      totals[agent.model] = (totals[agent.model] ?? 0) + agent.total;
    }
  }

  return totals;
}

export function modelEffortBreakdownMap(
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  limit: number,
): Map<string, EffortBreakdownRow[]> {
  return new Map(
    modelEffortBreakdowns(sessions, pricing, limit).map((row) => [row.model, row.effortRows]),
  );
}

export function modelEffortBreakdowns(
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  limit: number,
): ModelEffortBreakdown[] {
  const topModels = topEntries(aggregateSessions(sessions).modelUsage, limit).map(({ key }) => key);
  const modelSet = new Set(topModels);
  const rowsByModel = aggregateEffortBuckets(sessions, pricing, modelSet);

  return topModels.map((model) => ({
    effortRows: buildModelEffortRows(rowsByModel.get(model) ?? new Map()),
    model,
  }));
}

function aggregateEffortBuckets(
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  modelSet: Set<string>,
): Map<string, Map<string, EffortAggregationBucket>> {
  const rowsByModel = new Map<string, Map<string, EffortAggregationBucket>>();

  for (const session of sessions) {
    addStateSeconds(rowsByModel, session, modelSet);
    addRequestMetrics(rowsByModel, session, pricing, modelSet);
  }

  return rowsByModel;
}

function addStateSeconds(
  rowsByModel: Map<string, Map<string, EffortAggregationBucket>>,
  session: ParsedSession,
  modelSet: Set<string>,
): void {
  for (const [key, seconds] of Object.entries(session.stateActiveSeconds)) {
    const { effort, model } = splitStateKey(key);
    if (!modelSet.has(model)) {
      continue;
    }
    ensureEffortBucket(ensureEffortMap(rowsByModel, model), effort).activeSeconds += seconds;
  }
}

function addRequestMetrics(
  rowsByModel: Map<string, Map<string, EffortAggregationBucket>>,
  session: ParsedSession,
  pricing: Record<string, PricingInfo>,
  modelSet: Set<string>,
): void {
  for (const request of session.requests) {
    if (!modelSet.has(request.model)) {
      continue;
    }
    const bucket = ensureEffortBucket(ensureEffortMap(rowsByModel, request.model), request.effort);
    bucket.requestCount += 1;
    bucket.reasoningRequestCount += request.reasoningAvailability === "known" ? 1 : 0;
    if (request.contextSize > 0) {
      bucket.contextCount += 1;
      bucket.contextTotal += request.contextSize;
    }
    addRequestTokens(bucket.tokenInfo, request);
    bucket.costBreakdown = estimateCostBreakdown(request.model, bucket.tokenInfo, pricing);
  }
}

function addRequestTokens(tokenInfo: ModelTokenUsage, request: SessionRequest): void {
  tokenInfo.billableOutput += request.output + request.reasoning;
  tokenInfo.cacheWrite += request.cacheWrite;
  tokenInfo.cacheWrite1h += request.cacheWrite1h;
  tokenInfo.cached += request.cacheRead;
  tokenInfo.input += request.input;
  tokenInfo.output += request.output;
  tokenInfo.reasoning += request.reasoning;
  tokenInfo.total += request.total;
}

function buildModelEffortRows(
  effortMap: Map<string, EffortAggregationBucket>,
): EffortBreakdownRow[] {
  const baseline = baselineMetrics(effortMap.get("medium"));

  return [...effortMap.entries()]
    .sort((a, b) => effortRank(a[0]) - effortRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([effort, bucket]) => buildEffortBreakdownRow(effort, bucket, baseline));
}

// fallow-ignore-next-line complexity
function baselineMetrics(baseline: EffortAggregationBucket | undefined) {
  return {
    contextPerRequest:
      baseline && baseline.contextCount > 0
        ? baseline.contextTotal / baseline.contextCount
        : undefined,
    costPerActiveMinute: metricPerMinute(baseline?.costBreakdown?.total, baseline?.activeSeconds),
    costPerRequest: metricPerRequest(baseline?.costBreakdown?.total, baseline?.requestCount),
    outputPerRequest: metricPerRequest(baseline?.tokenInfo.output, baseline?.requestCount),
    reasoningPerRequest: metricPerRequest(
      baseline?.tokenInfo.reasoning,
      baseline?.reasoningRequestCount,
    ),
    tokensPerRequest: metricPerRequest(baseline?.tokenInfo.total, baseline?.requestCount),
  };
}

function buildEffortBreakdownRow(
  effort: string,
  bucket: EffortAggregationBucket,
  baseline: ReturnType<typeof baselineMetrics>,
): EffortBreakdownRow {
  const requestCount = bucket.requestCount;
  const costPerRequest = metricPerRequest(bucket.costBreakdown?.total, requestCount);
  const costPerActiveMinute = metricPerMinute(bucket.costBreakdown?.total, bucket.activeSeconds);
  const tokensPerRequest = metricPerRequestOrZero(bucket.tokenInfo.total, requestCount);
  const outputPerRequest = metricPerRequestOrZero(bucket.tokenInfo.output, requestCount);
  const reasoningAvailability = availabilityFromCounts(bucket.reasoningRequestCount, requestCount);
  const reasoningPerRequest = metricPerRequest(
    bucket.tokenInfo.reasoning,
    bucket.reasoningRequestCount,
  );
  const contextPerRequest =
    bucket.contextCount > 0 ? bucket.contextTotal / bucket.contextCount : undefined;

  return {
    activeSeconds: bucket.activeSeconds,
    activeSecondsPerRequest: metricPerRequest(bucket.activeSeconds, requestCount),
    cachedPerRequest: metricPerRequestOrZero(bucket.tokenInfo.cached, requestCount),
    contextPerRequest,
    contextPerRequestUplift: uplift(contextPerRequest, baseline.contextPerRequest),
    costBreakdownPerRequest: divideCostBreakdown(bucket.costBreakdown, requestCount),
    costPerActiveMinute,
    costPerActiveMinuteUplift: uplift(costPerActiveMinute, baseline.costPerActiveMinute),
    costPerRequest,
    costPerRequestUplift: uplift(costPerRequest, baseline.costPerRequest),
    effort,
    inputPerRequest: metricPerRequestOrZero(bucket.tokenInfo.input, requestCount),
    outputPerRequest,
    outputPerRequestUplift: uplift(outputPerRequest, baseline.outputPerRequest),
    reasoningAvailability,
    reasoningPerRequest,
    reasoningPerRequestUplift: uplift(reasoningPerRequest, baseline.reasoningPerRequest),
    requests: requestCount,
    tokensPerRequest,
    tokensPerRequestUplift: uplift(tokensPerRequest, baseline.tokensPerRequest),
  };
}

function ensureEffortMap(
  rowsByModel: Map<string, Map<string, EffortAggregationBucket>>,
  model: string,
) {
  let effortMap = rowsByModel.get(model);
  if (!effortMap) {
    effortMap = new Map();
    rowsByModel.set(model, effortMap);
  }
  return effortMap;
}

function ensureEffortBucket(effortMap: Map<string, EffortAggregationBucket>, effort: string) {
  let bucket = effortMap.get(effort);
  if (!bucket) {
    bucket = {
      activeSeconds: 0,
      contextCount: 0,
      contextTotal: 0,
      reasoningRequestCount: 0,
      requestCount: 0,
      tokenInfo: {
        billableOutput: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        cached: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        total: 0,
      },
    };
    effortMap.set(effort, bucket);
  }
  return bucket;
}

function metricPerRequest(
  value: number | undefined,
  requestCount: number | undefined,
): number | undefined {
  return value !== undefined && requestCount && requestCount > 0 ? value / requestCount : undefined;
}

function metricPerMinute(
  value: number | undefined,
  activeSeconds: number | undefined,
): number | undefined {
  return value !== undefined && activeSeconds && activeSeconds > 0
    ? value / (activeSeconds / 60)
    : undefined;
}

function metricPerRequestOrZero(value: number, requestCount: number): number {
  return requestCount > 0 ? value / requestCount : 0;
}

function divideCostBreakdown(
  cost: CostBreakdown | undefined,
  requestCount: number,
): CostBreakdown | undefined {
  return cost && requestCount > 0
    ? {
        cacheWrite: cost.cacheWrite / requestCount,
        cached: cost.cached / requestCount,
        input: cost.input / requestCount,
        output: cost.output / requestCount,
        total: cost.total / requestCount,
      }
    : undefined;
}

function uplift(value: number | undefined, baseline: number | undefined): number | undefined {
  return value !== undefined && baseline !== undefined && baseline > 0
    ? value / baseline - 1
    : undefined;
}

function formatUpliftNote(value: number | undefined): string {
  if (value === undefined) {
    return "vs medium n/a";
  }
  const sign = value >= 0 ? "+" : "";
  return `vs medium ${sign}${(value * 100).toFixed(1)}%`;
}

function effortRank(effort: string): number {
  return { low: 0, medium: 1, high: 2, unknown: 98 }[effort] ?? 50;
}

const PRICING_CANDIDATES = new WeakMap<Record<string, PricingInfo>, Map<string, string[]>>();

function pricingCandidates(pricing: Record<string, PricingInfo>): Map<string, string[]> {
  const cached = PRICING_CANDIDATES.get(pricing);
  if (cached) {
    return cached;
  }

  const candidates = new Map<string, string[]>();
  for (const modelId of Object.keys(pricing)) {
    const separator = modelId.indexOf("/");
    const unqualifiedId = separator >= 0 ? modelId.slice(separator + 1) : modelId;
    const normalized = normalizeModelId(unqualifiedId);
    candidates.set(normalized, [...(candidates.get(normalized) ?? []), modelId]);
  }
  PRICING_CANDIDATES.set(pricing, candidates);
  return candidates;
}

function normalizeModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replaceAll(".", "-")
    .replace(/:free$/, "-free");
}

function canonicalPublisher(modelId: string): string | undefined {
  const unqualifiedId = modelId.slice(modelId.lastIndexOf("/") + 1).toLowerCase();
  if (unqualifiedId.startsWith("claude-")) {
    return "anthropic";
  }
  if (/^(?:gpt-|o\d)/.test(unqualifiedId)) {
    return "openai";
  }
  return undefined;
}

function originatorSections(source: SourceId, sessions: ParsedSession[]): SourceSection[] {
  const grouped = new Map<string, ParsedSession[]>();

  for (const session of sessions) {
    const label = originatorLabel(source, session.originator);
    if (!label) {
      continue;
    }
    const bucket = grouped.get(label) ?? [];
    bucket.push(session);
    grouped.set(label, bucket);
  }

  return [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([label, bucket]) =>
      makeSection(
        `${sourceSectionTitle(source)} via ${label}`,
        bucket,
        originatorTone(label),
        "originator",
      ),
    );
}

function originatorTone(label: string): string {
  if (label === "T3 Code") {
    return SOURCE_TONES.t3code;
  }
  return SOURCE_TONES.other;
}

function sourceSectionTitle(source: SourceId): string {
  return { claude: "Claude Code", codex: "Codex", opencode: "opencode", pi: "Pi" }[source];
}

function makeSection(
  title: string,
  sessions: ParsedSession[],
  tone: string,
  kind: SourceSection["kind"],
): SourceSection {
  return { kind, sessions, stats: aggregateSessions(sessions), title, tone };
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
  return calendarDate(value);
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
  target.cacheWrite1h += source.cacheWrite1h;
  target.cached += source.cached;
  target.input += source.input;
  target.output += source.output;
  target.reasoning += source.reasoning;
  target.total += source.total;
}

function zeroTokens(): TokenUsage {
  return {
    cacheWrite: 0,
    cacheWrite1h: 0,
    cached: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  };
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
  const rates = pricing[resolveModelId(request.model, pricing)];
  if (!rates?.prompt) {
    return undefined;
  }

  const prompt = rates.prompt;
  const cacheReadWeight = rates.cacheRead === undefined ? 1 : rates.cacheRead / prompt;
  const cacheWriteWeight = rates.cacheWrite === undefined ? 1 : rates.cacheWrite / prompt;
  const cacheWrite1hWeight =
    rates.cacheWrite1h === undefined ? cacheWriteWeight : rates.cacheWrite1h / prompt;
  const oneHourWriteTokens = Math.min(request.cacheWrite, request.cacheWrite1h);

  return (
    request.input +
    request.cacheRead * cacheReadWeight +
    (request.cacheWrite - oneHourWriteTokens) * cacheWriteWeight +
    oneHourWriteTokens * cacheWrite1hWeight
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
