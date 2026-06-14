import { compactTokens, humanSeconds } from "./report-core.js";
import {
  estimateStatsTotalCost,
  formatUsd,
  topEntries,
  type BuiltReport,
  type PricingInfo,
  type SourceSection,
} from "./report-data.js";

export function renderTerminalReport(
  report: BuiltReport,
  pricing: Record<string, PricingInfo>,
): string {
  const lines: string[] = [];
  const combinedCost = formatUsd(estimateStatsTotalCost(report.combined.stats, pricing));

  lines.push(`AGENT USAGE DASHBOARD`);
  lines.push(report.scopeTitle);
  lines.push(
    `ACTIVE ${humanSeconds(report.combined.stats.activeSeconds)}  SESSIONS ${report.combined.stats.sessionCount}  TOKENS ${compactTokens(report.combined.stats.tokens.total)}  COST ${combinedCost}`,
  );
  lines.push("");

  for (const section of report.sections) {
    lines.push(...renderSection(section, pricing));
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
      ? "  Attribution check  model/effort-attributed active time stays within deduped parent active time."
      : `  Attribution warning  ${report.attributionOverages.length} sessions with attributed time > deduped parent active time`,
  );

  return `${lines.join("\n")}\n`;
}

function renderSection(section: SourceSection, pricing: Record<string, PricingInfo>): string[] {
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
  lines.push(
    ...renderTopList(
      "Languages",
      topEntries(stats.languages, 5).map(({ key, value }) => [key, String(value)]),
    ),
  );
  lines.push(
    ...renderTopList(
      "Models",
      topEntries(stats.modelUsage, 5).map(({ key, value }) => [key, String(value)]),
    ),
  );
  lines.push(
    ...renderTopList(
      "Reasoning effort",
      topEntries(stats.efforts, 5).map(({ key, value }) => [key, String(value)]),
    ),
  );
  return lines;
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

function formatShortDate(value: Date): string {
  return value.toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}
