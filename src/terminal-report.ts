import type { ReportMode } from "./args.js";
import { compactTokens, humanSeconds } from "./report-core.js";
import {
  ALL_SECTIONS,
  DEFAULT_SECTIONS,
  inferSectionModeForScope,
  sanitizeSectionsForScope,
  type SectionKey,
} from "./sections.js";
import {
  buildRequestSummaryData,
  formatFloat,
  estimateStatsTotalCost,
  formatUsd,
  modelRows,
  summarizeDistribution,
  topEntries,
  type BuiltReport,
  type DailyBreakdownRow,
  type PricingInfo,
  type ReportStats,
  type SourceSection,
} from "./report-data.js";

export function renderTerminalReport(
  report: BuiltReport,
  pricing: Record<string, PricingInfo>,
  reportMode: ReportMode = "summary",
  sections: SectionKey[] = reportMode === "full" ? ALL_SECTIONS : DEFAULT_SECTIONS,
): string {
  const resolvedSections = sanitizeSectionsForScope(report.scope, sections);
  const lines: string[] = [];
  const combinedCost = formatUsd(estimateStatsTotalCost(report.combined.stats, pricing));
  const activeSections = new Set(resolvedSections);
  const mode = inferSectionModeForScope(report.scope, resolvedSections);

  lines.push(`AGENT USAGE DASHBOARD`);
  lines.push(report.scopeTitle);
  lines.push(
    `ACTIVE ${humanSeconds(report.combined.stats.activeSeconds)}  SESSIONS ${report.combined.stats.sessionCount}  TOKENS ${compactTokens(report.combined.stats.tokens.total)}  COST ${combinedCost}`,
  );
  lines.push("");

  if (mode === "full") {
    lines.push(
      "Legend: input=fresh prompt, cached=cache reads, cache write=cache creation, output=visible output, reasoning=hidden/thinking output, total=provider total when present.",
    );
    lines.push("");
  }

  lines.push(...renderSelectedSummary(report, pricing, activeSections, mode === "full"));
  lines.push("");

  if (activeSections.has("source-sections")) {
    for (const section of report.sections.filter((item) => shouldShowSection(item.title, mode))) {
      lines.push(
        ...renderSection(section, pricing, activeSections.has("source-section-languages")),
      );
      lines.push("");
    }
  }

  lines.push("HIGHLIGHTS");
  if (report.requestSummarySessions.length === 0) {
    lines.push("  No sessions found in this range.");
  } else {
    const longest = [...report.requestSummarySessions].sort(
      (a, b) => b.activeSeconds - a.activeSeconds,
    )[0];
    const latest = [...report.requestSummarySessions].sort(
      (a, b) => b.end.getTime() - a.end.getTime(),
    )[0];
    lines.push(
      `  Longest active  ${longest.sourceLabel} · ${humanSeconds(longest.activeSeconds)} · ${longest.repo}`,
    );
    lines.push(
      `  Latest session  ${latest.sourceLabel} · ${formatShortDate(latest.end)} · ${latest.repo}`,
    );
  }
  lines.push(
    report.attributionOverages.length === 0
      ? "  Attribution  ok"
      : `  Attribution warning  ${report.attributionOverages.length} sessions with attributed time > deduped parent active time`,
  );

  return `${lines.join("\n")}\n`;
}

function renderSelectedSummary(
  report: BuiltReport,
  pricing: Record<string, PricingInfo>,
  sections: Set<SectionKey>,
  full: boolean,
): string[] {
  const blocks: Array<{ key: SectionKey; render: () => string[] }> = [
    {
      key: "request-summary",
      render: () =>
        renderRequestSummary(
          full ? "Combined request summary" : "Summary",
          report.requestSummary,
          report.combined.stats,
          pricing,
          full,
        ),
    },
    {
      key: "gpt-only-request-summary",
      render: () =>
        renderRequestSummary(
          "GPT-only request summary",
          report.gptOnlyRequestSummary,
          report.gptOnly.stats,
          pricing,
          true,
        ),
    },
    { key: "daily-usage", render: () => renderDailyUsage(report, full) },
    { key: "daily-breakdown", render: () => renderDailyBreakdown(report.dailyRows) },
    { key: "source-share", render: () => renderSourceShares(report) },
    {
      key: "model-breakdown",
      render: () => renderModelList(modelRows(report.combined.stats, pricing, 6)),
    },
    { key: "token-mix", render: () => renderTokenBreakdown(report.combined.stats) },
    {
      key: "top-repos",
      render: () =>
        renderTopList(
          "Top repos",
          topEntries(report.combined.stats.repos, 5).map(({ key, value }) => [
            key,
            humanSeconds(value),
          ]),
        ),
    },
  ];

  const selectedBlocks = blocks.filter((block) => sections.has(block.key));
  return selectedBlocks.flatMap((block, index) => {
    const rendered = block.render();
    return index === selectedBlocks.length - 1 ? rendered : [...rendered, ""];
  });
}

function renderSection(
  section: SourceSection,
  pricing: Record<string, PricingInfo>,
  full: boolean,
): string[] {
  const { stats, title } = section;
  const lines = [
    title.toUpperCase(),
    `  Active time     ${humanSeconds(stats.activeSeconds)}`,
    `  Sessions        ${stats.sessionCount}`,
    `  Requests        ${stats.requestCount}`,
    `  Est cost        ${formatUsd(estimateStatsTotalCost(stats, pricing))}`,
    `  Input           ${compactTokens(stats.tokens.input)}`,
    `  Cached          ${compactTokens(stats.tokens.cached)}`,
    `  Cache write     ${compactTokens(stats.tokens.cacheWrite)}`,
    `  Output          ${compactTokens(stats.tokens.output)}`,
    `  Reasoning       ${compactTokens(stats.tokens.reasoning)}`,
    `  Total           ${compactTokens(stats.tokens.total)}`,
  ];

  lines.push(
    ...renderTopList(
      "Top repos",
      topEntries(stats.repos, 4).map(({ key, value }) => [key, humanSeconds(value)]),
    ),
  );
  lines.push(...renderModelList(modelRows(stats, pricing, 5)));
  lines.push(
    ...renderTopList(
      "Reasoning effort",
      topEntries(stats.efforts, 5).map(({ key, value }) => [key, String(value)]),
    ),
  );
  if (full) {
    lines.push(
      ...renderTopList(
        "Languages",
        topEntries(stats.languages, 5).map(({ key, value }) => [key, String(value)]),
      ),
    );
  }
  return lines;
}

function renderSourceShares(report: BuiltReport): string[] {
  return renderTopList(
    "Source share",
    report.sections
      .filter((section) => isPrimarySection(section.title))
      .map(
        (section) => [section.title, humanSeconds(section.stats.activeSeconds)] as [string, string],
      ),
  );
}

function renderTokenBreakdown(stats: ReportStats): string[] {
  return [
    "  Token mix",
    `    • input · ${compactTokens(stats.tokens.input)}`,
    `    • cached · ${compactTokens(stats.tokens.cached)}`,
    `    • output · ${compactTokens(stats.tokens.output)}`,
    `    • reasoning · ${compactTokens(stats.tokens.reasoning)}`,
    `    • total · ${compactTokens(stats.tokens.total)}`,
  ];
}

function renderTopList(title: string, rows: Array<[string, string]>): string[] {
  const lines = [`  ${title}`];
  if (rows.length === 0) {
    lines.push("    none");
    return lines;
  }
  for (const [name, value] of rows) {
    lines.push(`    • ${name} · ${value}`);
  }
  return lines;
}

function renderModelList(rows: ReturnType<typeof modelRows>): string[] {
  const lines = ["  Models"];
  if (rows.length === 0) {
    lines.push("    none");
    return lines;
  }
  for (const row of rows) {
    lines.push(
      `    - ${row.key} · ${row.pct.toFixed(0)}% · in ${compactTokens(row.tokenInfo.input)} (${row.inputRate}) · cached ${compactTokens(row.tokenInfo.cached)} · write ${compactTokens(row.tokenInfo.cacheWrite)} · out ${compactTokens(row.tokenInfo.output)} (${row.outputRate}) · reason ${compactTokens(row.tokenInfo.reasoning)} · est ${row.cost}`,
    );
  }
  return lines;
}

function renderRequestSummary(
  title: string,
  source: BuiltReport["requestSummary"],
  stats: ReportStats,
  pricing: Record<string, PricingInfo>,
  full: boolean,
): string[] {
  const data = buildRequestSummaryData(source, stats, pricing);
  const lines = [
    title.toUpperCase(),
    `  Model requests  ${data.requests.length}`,
    `  User turns      ${stats.userTurns}`,
    `  Assistant turns ${stats.assistantTurns}`,
    `  Requests/hour   ${formatFloat(data.requests.length / data.hours)}`,
    `  Tokens/request  ${averageMetric(stats.tokens.total, data.requests.length)}`,
    `  Output/request  ${averageMetric(stats.tokens.output, data.requests.length)}`,
    `  Avg context     ${formatContext(data.context.average)}`,
    `  Median context  ${formatContext(data.context.median)}`,
    `  Peak context    ${formatContext(data.context.peak)}`,
    `  Context growth  ${formatContext(data.context.growth)}`,
    `  Cache read ratio ${formatCacheRatio(data.cache.cacheReadRatio)}`,
  ];

  if (full) {
    lines.push(`  Weighted input eq/req  ${formatFloat(data.cache.weightedInputEqPerRequest)}`);
    lines.push(...renderDistributionSummary("Tokens / active minute", data.rows[0].summary));
    lines.push(...renderDistributionSummary("Fresh input / active minute", data.rows[1].summary));
    lines.push(...renderDistributionSummary("Cached input / active minute", data.rows[2].summary));
    lines.push(...renderDistributionSummary("Output / active minute", data.rows[3].summary));
    lines.push(...renderDistributionSummary("Total tokens / turn", data.rows[4].summary));
    lines.push(...renderDistributionSummary("Context size / request", data.rows[5].summary));
  } else {
    lines.push(...renderCompactDistribution("Tokens / active minute", data.rows[0].summary));
    lines.push(...renderCompactDistribution("Context size / request", data.rows[5].summary));
  }

  return lines;
}

function renderCompactDistribution(
  title: string,
  summary: ReturnType<typeof summarizeDistribution>,
): string[] {
  return [
    `  ${title}`,
    `    median ${formatFloat(summary.median)}`,
    `    p90    ${formatFloat(summary.p90)}`,
  ];
}

function isPrimarySection(title: string): boolean {
  return ["Codex", "opencode", "Claude Code", "Pi"].includes(title);
}

function shouldShowSection(title: string, mode: "summary" | "full" | "custom"): boolean {
  return mode === "full" ? true : isPrimarySection(title);
}

function renderDistributionSummary(
  title: string,
  summary: ReturnType<typeof summarizeDistribution>,
): string[] {
  return [
    `  ${title}`,
    `    median ${formatFloat(summary.median)}`,
    `    mean   ${formatFloat(summary.mean)}`,
    `    p75    ${formatFloat(summary.p75)}`,
    `    p90    ${formatFloat(summary.p90)}`,
    `    max    ${formatFloat(summary.max)}`,
  ];
}

function renderDailyBreakdown(rows: DailyBreakdownRow[]): string[] {
  const lines = ["DAILY MODEL BREAKDOWN"];
  if (rows.length === 0) {
    lines.push("  No request-level rows in this range.");
    return lines;
  }

  lines.push(
    "  date       harness  sub        model                    effort   active  sess  req  fresh  cached  output  reason",
  );
  for (const row of rows.slice(0, 20)) {
    lines.push(
      `  ${row.date} ${pad(row.harness, 8)} ${pad(row.subharness, 10)} ${pad(row.model, 24)} ${pad(row.effort, 8)} ${padLeft(humanSeconds(row.activeSeconds), 6)} ${padLeft(String(row.sessions), 4)} ${padLeft(String(row.requests), 4)} ${padLeft(compactTokens(row.input), 6)} ${padLeft(compactTokens(row.cached), 7)} ${padLeft(compactTokens(row.output), 7)} ${padLeft(compactTokens(row.reasoning), 7)}`,
    );
  }
  return lines;
}

function renderDailyUsage(report: BuiltReport, full: boolean): string[] {
  const lines = [
    "DAILY USAGE",
    `  Avg tokens/day ${formatContext(report.dailyUsage.avgTokens)}`,
    `  Active avg tok ${formatContext(report.dailyUsage.activeDayAvgTokens)}`,
    `  Median tok/day ${formatContext(report.dailyUsage.tokenMedian)}`,
    `  P90 tok/day    ${formatContext(report.dailyUsage.tokenP90)}`,
    `  Tok volatility ${formatPercent(report.dailyUsage.tokenVolatility)}`,
    `  Avg cost/day   ${formatUsd(report.dailyUsage.avgCost)}`,
    `  Active avg $   ${formatUsd(report.dailyUsage.activeDayAvgCost)}`,
    `  Median $/day   ${formatUsd(report.dailyUsage.costMedian)}`,
    `  P90 $/day      ${formatUsd(report.dailyUsage.costP90)}`,
    `  $ volatility   ${formatPercent(report.dailyUsage.costVolatility)}`,
  ];
  const rows = full ? report.dailyUsage.rows : report.dailyUsage.rows.slice(-7);
  if (rows.length === 0) {
    lines.push("  No days in range.");
    return lines;
  }

  lines.push("  date         active   req   tokens   cost");
  for (const row of rows) {
    lines.push(
      `  ${row.date} ${padLeft(humanSeconds(row.activeSeconds), 6)} ${padLeft(String(row.requestCount), 4)} ${padLeft(compactTokens(row.tokens), 8)} ${padLeft(formatUsd(row.cost), 8)}`,
    );
  }
  return lines;
}

function formatContext(value: number | undefined): string {
  return value === undefined ? "n/a" : compactTokens(Math.round(value));
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function averageMetric(total: number, count: number): string {
  return formatFloat(count > 0 ? total / count : undefined);
}

function formatCacheRatio(value: number | undefined): string {
  return value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function pad(value: string, width: number): string {
  return value.slice(0, width).padEnd(width, " ");
}

function padLeft(value: string, width: number): string {
  return value.slice(0, width).padStart(width, " ");
}

function formatShortDate(value: Date): string {
  return value.toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}
