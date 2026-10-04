import type { ModelTokenUsage, TokenUsage } from "./domain.js";
import {
  estimateCost,
  estimateStatsTotalCost,
  resolveModelId,
  unpricedModels,
  type PricingInfo,
} from "./pricing.js";
import { isPrimarySection } from "./render-shared.js";
import type { Scope } from "./report-core.js";
import type { BuiltReport, ReportStats } from "./report-data.js";

type JsonTotals = {
  activeSeconds: number;
  cost: number | null;
  requests: number;
  sessions: number;
  tokens: TokenUsage;
};

/** Report data printed by `--json`, for scripts and agents that inspect results. */
export type JsonReport = {
  daily: Array<{
    activeSeconds: number;
    cost: number | null;
    date: string;
    requests: number;
    tokens: number;
  }>;
  generatedAt: string;
  models: Array<{
    activeSeconds: number;
    cost: number | null;
    model: string;
    pricingId: string | null;
    requests: number;
    tokens: ModelTokenUsage | null;
  }>;
  pricingLoaded: boolean;
  scope: Scope;
  scopeTitle: string;
  sources: Array<JsonTotals & { title: string }>;
  totals: JsonTotals;
  unpricedModels: string[];
};

export function buildJsonReport(
  report: BuiltReport,
  pricing: Record<string, PricingInfo>,
): JsonReport {
  const stats = report.combined.stats;
  return {
    daily: report.dailyUsage.rows.map((row) => ({
      activeSeconds: row.activeSeconds,
      cost: row.cost ?? null,
      date: row.date,
      requests: row.requestCount,
      tokens: row.tokens,
    })),
    generatedAt: report.generatedAt.toISOString(),
    models: Object.entries(stats.modelUsage)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([model, requests]) => {
        const tokens = stats.modelTokens[model];
        const pricingId = resolveModelId(model, pricing, tokens?.provider);
        return {
          activeSeconds: stats.modelActiveSeconds[model] ?? 0,
          cost: tokens ? (estimateCost(model, tokens, pricing) ?? null) : null,
          model,
          pricingId: Object.hasOwn(pricing, pricingId) ? pricingId : null,
          requests,
          tokens: tokens ?? null,
        };
      }),
    pricingLoaded: Object.keys(pricing).length > 0,
    scope: report.scope,
    scopeTitle: report.scopeTitle,
    sources: report.sections.filter(isPrimarySection).map((section) => ({
      title: section.title,
      ...jsonTotals(section.stats, pricing),
    })),
    totals: jsonTotals(stats, pricing),
    unpricedModels: unpricedModels(stats.modelTokens, pricing),
  };
}

function jsonTotals(stats: ReportStats, pricing: Record<string, PricingInfo>): JsonTotals {
  return {
    activeSeconds: stats.activeSeconds,
    cost: estimateStatsTotalCost(stats, pricing) ?? null,
    requests: stats.requestCount,
    sessions: stats.sessionCount,
    tokens: stats.tokens,
  };
}
