import type { ReportMode } from "./args.js";
import { compactTokens, humanSeconds } from "./report-core.js";
import {
  formatFloat,
  estimateStatsTotalCost,
  formatUsd,
  modelRows,
  sessionDistributions,
  summarizeDistribution,
  summarizeRequestCache,
  summarizeRequestContexts,
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
): string {
  const lines: string[] = [];
  const combinedCost = formatUsd(estimateStatsTotalCost(report.combined.stats, pricing));

  lines.push(`AGENT USAGE DASHBOARD`);
  lines.push(report.scopeTitle);
  lines.push(
    `ACTIVE ${humanSeconds(report.combined.stats.activeSeconds)}  SESSIONS ${report.combined.stats.sessionCount}  TOKENS ${compactTokens(report.combined.stats.tokens.total)}  COST ${combinedCost}`,
  );
  lines.push("");

  if (reportMode === "full") {
    lines.push(
      "Legend: input=fresh prompt, cached=cache reads, cache write=cache creation, output=visible output, reasoning=hidden/thinking output, total=provider total when present.",
    );
    lines.push("");
    lines.push(
      ...renderRequestSummary(
        "Combined request summary",
        report.requestSummarySessions,
        report.combined.stats,
        pricing,
        true,
      ),
    );
    lines.push("");
    lines.push(
      ...renderRequestSummary(
        "GPT-only request summary",
        report.gptOnly.sessions,
        report.gptOnly.stats,
        pricing,
        true,
      ),
    );
    lines.push("");
    lines.push(...renderDailyBreakdown(report.dailyRows));
    lines.push("");

    for (const section of report.sections) {
      lines.push(...renderSection(section, pricing, true));
      lines.push("");
    }
  } else {
    lines.push(...renderSummary(report, pricing));
    lines.push("");
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

function renderSummary(report: BuiltReport, pricing: Record<string, PricingInfo>): string[] {
  const lines = [
    ...renderRequestSummary(
      "Summary",
      report.requestSummarySessions,
      report.combined.stats,
      pricing,
      false,
    ),
    ...renderSourceShares(report),
    ...renderModelList(modelRows(report.combined.stats, pricing, 6)),
    ...renderTokenBreakdown(report.combined.stats),
    ...renderTopList(
      "Top repos",
      topEntries(report.combined.stats.repos, 5).map(({ key, value }) => [
        key,
        humanSeconds(value),
      ]),
    ),
  ];

  for (const section of report.sections.filter((item) => isPrimarySection(item.title))) {
    lines.push(...renderSection(section, pricing, false));
  }
  return lines;
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
  sessions: BuiltReport["requestSummarySessions"],
  stats: ReportStats,
  pricing: Record<string, PricingInfo>,
  full: boolean,
): string[] {
  const requests = sessions.flatMap((session) => session.requests);
  const hours = Math.max(stats.activeSeconds / 3600, 1 / 3600);
  const context = summarizeRequestContexts(requests);
  const cache = summarizeRequestCache(requests, pricing);
  const dists = sessionDistributions(sessions);
  const lines = [
    title.toUpperCase(),
    `  Model requests  ${requests.length}`,
    `  User turns      ${stats.userTurns}`,
    `  Assistant turns ${stats.assistantTurns}`,
    `  Requests/hour   ${formatFloat(requests.length / hours)}`,
    `  Tokens/request  ${formatFloat(requests.length > 0 ? stats.tokens.total / requests.length : undefined)}`,
    `  Output/request  ${formatFloat(requests.length > 0 ? stats.tokens.output / requests.length : undefined)}`,
    `  Avg context     ${formatContext(context.average)}`,
    `  Median context  ${formatContext(context.median)}`,
    `  Peak context    ${formatContext(context.peak)}`,
    `  Context growth  ${formatContext(context.growth)}`,
    `  Cache read ratio ${cache.cacheReadRatio === undefined ? "n/a" : `${(cache.cacheReadRatio * 100).toFixed(1)}%`}`,
  ];

  if (full) {
    lines.push(`  Weighted input eq/req  ${formatFloat(cache.weightedInputEqPerRequest)}`);
    lines.push(...renderDistribution("Tokens / active minute", dists.tokensPerActiveMinute));
    lines.push(
      ...renderDistribution("Fresh input / active minute", dists.freshInputPerActiveMinute),
    );
    lines.push(
      ...renderDistribution("Cached input / active minute", dists.cachedInputPerActiveMinute),
    );
    lines.push(...renderDistribution("Output / active minute", dists.outputPerActiveMinute));
    lines.push(...renderDistribution("Total tokens / turn", dists.totalTokensPerTurn));
    lines.push(...renderDistribution("Context size / request", dists.contextSizePerRequest));
  } else {
    lines.push(...renderCompactDistribution("Tokens / active minute", dists.tokensPerActiveMinute));
    lines.push(...renderCompactDistribution("Context size / request", dists.contextSizePerRequest));
  }

  return lines;
}

function renderCompactDistribution(title: string, values: number[]): string[] {
  const summary = summarizeDistribution(values);
  return [
    `  ${title}`,
    `    median ${formatFloat(summary.median)}`,
    `    p90    ${formatFloat(summary.p90)}`,
  ];
}

function isPrimarySection(title: string): boolean {
  return ["Codex", "opencode", "Claude Code", "Pi"].includes(title);
}

function renderDistribution(title: string, values: number[]): string[] {
  const summary = summarizeDistribution(values);
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

function formatContext(value: number | undefined): string {
  return value === undefined ? "n/a" : compactTokens(Math.round(value));
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
