import type { ModelTokenUsage, ParsedSession, TelemetryAvailability } from "./domain.js";
import { estimateCostBreakdown, type CostBreakdown, type PricingInfo } from "./pricing.js";
import { splitStateKey } from "./report-core.js";
import {
  addRequestTokens,
  aggregateSessions,
  availabilityFromCounts,
  topEntries,
} from "./report-data.js";

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
