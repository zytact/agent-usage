import { writeFile } from "node:fs/promises";

import type { ReportMode } from "./args.js";
import { REPORT_CSS } from "./html-report-css.js";
import { effortCostMix, effortMetricCells, modelEffortBreakdownMap } from "./effort-breakdown.js";
import { compactMetric, formatEffortMetricValue } from "./effort-format.js";
import { estimateStatsTotalCost, pricingNotice, type PricingInfo } from "./pricing.js";
import { shouldShowSection } from "./render-shared.js";
import { calendarDate, compactTokens, humanSeconds } from "./report-core.js";
import {
  availabilityNote,
  displayCacheWrite,
  displayPartialCost,
  displayTelemetry,
} from "./telemetry-format.js";
import {
  ALL_SECTIONS,
  DEFAULT_SECTIONS,
  inferSectionModeForScope,
  sanitizeSectionsForScope,
  type SectionKey,
} from "./sections.js";
import {
  attributedModelTokenTotals,
  buildRequestSummaryData,
  cacheWriteAvailability,
  formatFloat,
  formatUsd,
  mixedWorkflowUsage,
  modelRows,
  modelRowsIncludingWorkflowModels,
  modelTelemetryAvailability,
  reasoningAvailability,
  workflowModelAttributions,
  percentRows,
  topEntries,
  type BuiltReport,
  type DailyBreakdownRow,
  type RequestDistributionRow,
  type ReportStats,
  type SourceSection,
} from "./report-data.js";

const SOURCE_NOTES = {
  claude: "Claude Code: ~/.claude/projects",
  codex: "Codex: ~/.codex/sessions",
  opencode: "opencode: ~/.local/share/opencode/opencode.db",
  pi: "Pi: ~/.pi/agent/sessions",
} as const;

export function renderHtmlReport(
  report: BuiltReport,
  pricing: Record<string, PricingInfo>,
  reportMode: ReportMode = "summary",
  sections: SectionKey[] = reportMode === "full" ? ALL_SECTIONS : DEFAULT_SECTIONS,
): string {
  const resolvedSections = sanitizeSectionsForScope(report.scope, sections);
  const activeSections = new Set(resolvedSections);
  const mode = inferSectionModeForScope(report.scope, resolvedSections);
  return renderHtmlDocument({
    activeSections,
    mode,
    pricing,
    report,
  });
}

type HtmlReportView = {
  activeSections: Set<SectionKey>;
  mode: "summary" | "full" | "custom";
  pricing: Record<string, PricingInfo>;
  report: BuiltReport;
};

function renderHtmlDocument(view: HtmlReportView): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent usage report · ${escapeHtml(view.report.scopeTitle)}</title>
<style>
${REPORT_CSS}
</style>
</head>
<body>
<main>
  ${renderHero(view.report, view.mode)}
  ${renderCombinedSummary(view.report, view.pricing)}
  ${renderNoDataNotice(view.report)}
  ${renderPricingNotice(view.report, view.pricing)}
  ${renderSelectedOverview(view.report, view.pricing, view.activeSections, view.mode === "full")}
  ${renderVisibleSourceSections(view)}
  ${renderFooter(view.report)}
</main>
</body>
</html>`;
}

function renderHero(report: BuiltReport, mode: HtmlReportView["mode"]): string {
  return `<header class="hero">
    <section class="hero-main">
      <p class="eyebrow">Local usage dossier</p>
      <h1>Agent usage</h1>
      <p class="hero-copy">See where your coding-agent time goes across sources, models, repositories, tokens, and estimated cost.</p>
    </section>
    <aside class="hero-side" aria-label="Report context">
      <div><p>Range</p><b>${escapeHtml(report.scopeTitle)}</b></div>
      <div><p>Generated</p><b>${escapeHtml(formatTimestamp(report.generatedAt))}</b></div>
      <div><p>Sources</p><b>${report.sourceCount} local stores</b></div>
      <div><p>Mode</p><b>${mode === "full" ? "Full" : mode === "summary" ? "Summary" : "Custom"}</b></div>
    </aside>
  </header>`;
}

function renderCombinedSummary(report: BuiltReport, pricing: Record<string, PricingInfo>): string {
  const combinedCost = displayCost(
    estimateStatsTotalCost(report.combined.stats, pricing),
    cacheWriteAvailability(report.combined.sessions),
  );
  return `<dl class="summary-grid" aria-label="Combined summary">
    ${htmlMetric("Active time", humanSeconds(report.combined.stats.activeSeconds))}
    ${htmlMetric("Sessions", String(report.combined.stats.sessionCount))}
    ${htmlMetric("Tokens", compactTokens(report.combined.stats.tokens.total), "provider total when present")}
    ${htmlMetric("Estimated cost", combinedCost, "models.dev rate card when available")}
  </dl>`;
}

function renderNoDataNotice(report: BuiltReport): string {
  return report.combined.stats.sessionCount === 0
    ? '<p class="notice">No sessions found in this range.</p>'
    : "";
}

function renderPricingNotice(report: BuiltReport, pricing: Record<string, PricingInfo>): string {
  const notice = pricingNotice(report.combined.stats.modelTokens, pricing);
  return notice ? `<p class="notice">${escapeHtml(notice)}</p>` : "";
}

function renderVisibleSourceSections(view: HtmlReportView): string {
  if (!view.activeSections.has("source-sections")) {
    return "";
  }

  return view.report.sections
    .filter((section) => shouldShowSection(section, view.mode, view.report.showOriginators))
    .map((section) =>
      renderSourceSection(
        section,
        view.pricing,
        view.activeSections.has("source-section-languages"),
      ),
    )
    .join("\n");
}

function renderFooter(report: BuiltReport): string {
  const sourcesNote = report.selectedSources.map((source) => SOURCE_NOTES[source]).join(" · ");
  const attributionWarning =
    report.attributionOverages.length === 0
      ? ""
      : `<p>${escapeHtml(`Attribution warning: ${report.attributionOverages.length} sessions exceeded deduped parent active time.`)}</p>`;

  return `<footer class="footer">
    <p><strong>Data sources:</strong> ${escapeHtml(sourcesNote)}</p>
    <p>Originator detection: Codex uses explicit subagent metadata (<code>thread_source</code>, <code>parent_thread_id</code>, or <code>source.subagent</code>) before session <code>originator</code>; Pi uses session <code>originator</code> / <code>thread_source</code> and treats <code>parentSession</code> as subagent lineage; opencode uses session titles and metadata heuristics; Claude Code uses <code>entrypoint</code> plus sidechain/subagent paths.</p>
    ${attributionWarning}
    <p>Cost is an estimate. Missing pricing data appears as n/a. This file is self-contained and reads no network resources.</p>
  </footer>`;
}

export async function writeHtmlReport(path: string, html: string): Promise<void> {
  await writeFile(path, html, "utf8");
}

function renderSourceSection(
  section: SourceSection,
  pricing: Record<string, PricingInfo>,
  full: boolean,
): string {
  const stats = section.stats;
  const repos = topEntries(stats.repos, 5).map(
    ({ key, value }) => [key, humanSeconds(value)] as const,
  );
  const days = Object.entries(stats.days)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 5)
    .map(([key, value]) => [key.slice(5), humanSeconds(value.activeSeconds)] as const);
  const costs = estimateStatsTotalCost(stats, pricing);
  const effortRows = percentRows(stats.efforts, 5);
  const writeAvailability = cacheWriteAvailability(section.sessions);
  const reasonAvailability = reasoningAvailability(section.sessions);
  const models = modelRowsIncludingWorkflowModels(stats, section.sessions, pricing, 5);
  const tokenTotal = Math.max(stats.tokens.total, 1);

  return `<section class="source-block" style="--tone:${escapeHtml(section.tone)}">
  <header class="source-head">
    <div>
      <h3>${escapeHtml(section.title)}</h3>
      <h2>${escapeHtml(humanSeconds(stats.activeSeconds))}</h2>
      <p class="panel-copy">Dense local activity, split by model, repo, language, and request shape.</p>
    </div>
    <dl>
      ${htmlMetric("Sessions", String(stats.sessionCount))}
      ${htmlMetric("Requests", String(stats.requestCount))}
      ${htmlMetric("Tokens", compactTokens(stats.tokens.total))}
      ${htmlMetric("Est cost", displayCost(costs, writeAvailability))}
    </dl>
  </header>
  <section class="token-panel">
    <h3>Token intensity</h3>
    <p>Total uses provider total when present, else input plus cached plus cache write plus output plus reasoning.</p>
    ${htmlTokenBar("Input", stats.tokens.input, tokenTotal, "input")}
    ${htmlTokenBar("Cached", stats.tokens.cached, tokenTotal, "cached")}
    ${htmlTokenBar("Cache write", stats.tokens.cacheWrite, tokenTotal, "cache-write", displayCacheWrite(stats.tokens.cacheWrite, writeAvailability), writeAvailability === "unknown" ? "not exposed by source" : writeAvailability === "partial" ? "partially reported" : undefined)}
    ${htmlTokenBar("Output", stats.tokens.output, tokenTotal, "output")}
    ${htmlTokenBar("Reasoning", stats.tokens.reasoning, tokenTotal, "reasoning", displayTelemetry(stats.tokens.reasoning, reasonAvailability), reasonAvailability === "unknown" ? "not separately reported" : reasonAvailability === "partial" ? "partially reported" : undefined)}
    ${htmlTokenBar("Total", stats.tokens.total, tokenTotal, "total")}
  </section>
  <div class="detail-grid ${full ? "detail-grid-full" : "detail-grid-summary"}">
    ${renderModelsPanel(models, section, pricing, writeAvailability)}
    ${renderShareList("Reasoning effort", effortRows, "No effort markers")}
    ${renderSimpleList("Top repos", repos)}
    ${
      full
        ? renderSimpleList(
            "Languages",
            topEntries(stats.languages, 5).map(({ key, value }) => [key, String(value)] as const),
            "language-panel",
          )
        : ""
    }
    ${renderSimpleList("Daily active", days, "daily-panel")}
  </div>
</section>`;
}

function renderSelectedOverview(
  report: BuiltReport,
  pricing: Record<string, PricingInfo>,
  sections: Set<SectionKey>,
  full: boolean,
): string {
  const parts: string[] = [];

  const charts = renderSelectedChartGrid(report, pricing, sections);
  if (charts) {
    parts.push(charts);
  }
  if (sections.has("top-repos")) {
    parts.push(renderCombinedTopReposPanel(report));
  }
  if (sections.has("daily-usage")) {
    parts.push(renderDailyStrip(report));
    parts.push(renderDailyUsagePanel(report, full));
  }
  if (sections.has("request-summary")) {
    parts.push(
      renderRequestSummary(
        "Combined request summary",
        report.requestSummary,
        report.combined.stats,
        pricing,
        full,
      ),
    );
  }
  if (sections.has("gpt-only-request-summary")) {
    parts.push(
      renderRequestSummary(
        "GPT-only request summary",
        report.gptOnlyRequestSummary,
        report.gptOnly.stats,
        pricing,
        true,
      ),
    );
  }
  if (sections.has("daily-breakdown")) {
    parts.push(renderDailyBreakdown(report.dailyRows));
  }

  return parts.join("\n");
}

function renderSelectedChartGrid(
  report: BuiltReport,
  pricing: Record<string, PricingInfo>,
  sections: Set<SectionKey>,
): string {
  const sourceRows = report.sections
    .filter((section) => section.kind === "primary")
    .map((section) => ({
      label: section.title,
      tone: section.tone,
      value: section.stats.activeSeconds,
      valueLabel: humanSeconds(section.stats.activeSeconds),
    }))
    .filter((row) => row.value > 0);
  const modelTokenTotals = attributedModelTokenTotals(report.combined.sessions);
  const totalAttributedModelTokens = Object.values(modelTokenTotals).reduce(
    (total, tokens) => total + tokens,
    0,
  );
  const modelTokenRows = topEntries(modelTokenTotals, 6)
    .filter((row) => row.value > 0)
    .map((row) => {
      const share = (row.value / totalAttributedModelTokens) * 100;
      return {
        label: row.key,
        tone: "var(--primary)",
        value: row.value,
        valueLabel: `${share.toFixed(0)}% · ${compactTokens(row.value)}`,
      };
    });
  const costRows = report.sections
    .filter((section) => section.kind === "primary")
    .map((section) => ({
      label: section.title,
      tone: section.tone,
      value: estimateStatsTotalCost(section.stats, pricing) ?? 0,
      valueLabel: formatUsd(estimateStatsTotalCost(section.stats, pricing)),
    }))
    .filter((row) => row.value > 0);
  const totalEstimatedCost = costRows.reduce((total, row) => total + row.value, 0);
  const tokenRows = [
    { label: "Fresh input", tone: "var(--input)", value: report.combined.stats.tokens.input },
    { label: "Cached", tone: "var(--cache)", value: report.combined.stats.tokens.cached },
    {
      label: "Cache write",
      tone: "var(--primary)",
      value: report.combined.stats.tokens.cacheWrite,
    },
    { label: "Output", tone: "var(--output)", value: report.combined.stats.tokens.output },
    {
      label: "Reasoning",
      tone: "var(--accent)",
      value: report.combined.stats.tokens.reasoning,
    },
  ].filter((row) => row.value > 0);

  const panels: string[] = [];

  if (sections.has("source-share")) {
    panels.push(`<section class="chart-panel">
    <h2>Source share</h2>
    ${renderRingChart(sourceRows, report.combined.stats.activeSeconds, "active time")}
  </section>`);
    panels.push(`<section class="chart-panel">
    <h2>Estimated cost by source</h2>
    ${renderBarList(costRows, totalEstimatedCost, "No priced usage")}
  </section>`);
  }
  if (sections.has("token-mix")) {
    panels.push(`<section class="chart-panel">
    <h2>Token composition</h2>
    ${renderTokenStackList(tokenRows)}
  </section>`);
  }
  if (sections.has("model-breakdown")) {
    panels.push(`<section class="chart-panel">
    <h2>Tokens by model</h2>
    ${renderBarList(modelTokenRows, totalAttributedModelTokens, "No attributed model tokens")}
  </section>`);
  }

  return panels.length === 0
    ? ""
    : `<section class="chart-grid" aria-label="Glanceable usage overview">${panels.join("\n")}
</section>`;
}

function renderCombinedTopReposPanel(report: BuiltReport): string {
  const repos = topEntries(report.combined.stats.repos, 8).map(
    ({ key, value }) => [key, humanSeconds(value)] as const,
  );
  const body =
    repos.length === 0
      ? '<li class="empty">None</li>'
      : repos
          .map(
            ([name, value]) =>
              `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></li>`,
          )
          .join("");
  return `<section class="data-panel"><h2>Top repos</h2><ul class="rank-list">${body}</ul></section>`;
}

function renderRequestSummary(
  title: string,
  source: BuiltReport["requestSummary"],
  stats: ReportStats,
  pricing: Record<string, PricingInfo>,
  full: boolean,
): string {
  const data = buildRequestSummaryData(source, stats, pricing);

  return `<section class="data-panel">
  <h2>${escapeHtml(title)}</h2>
  <div class="request-grid">
    ${htmlMetric("Model requests", String(data.requests.length))}
    ${htmlMetric("User turns", String(stats.userTurns))}
    ${htmlMetric("Assistant turns", String(stats.assistantTurns))}
    ${htmlMetric("Requests / active hour", formatFloat(data.requests.length / data.hours))}
    ${htmlMetric("Tokens / request", averageMetric(stats.tokens.total, data.requests.length))}
    ${htmlMetric("Output / request", averageMetric(stats.tokens.output, data.requests.length))}
    ${htmlMetric("Avg context", formatContextMetric(data.context.average))}
    ${htmlMetric("Median context", formatContextMetric(data.context.median))}
    ${htmlMetric("Peak context", formatContextMetric(data.context.peak))}
    ${htmlMetric("Context growth", formatContextMetric(data.context.growth))}
    ${htmlMetric("Cache read ratio", formatCacheRatio(data.cache.cacheReadRatio))}
    ${full ? htmlMetric("Weighted input eq/req", formatFloat(data.cache.weightedInputEqPerRequest)) : htmlMetric("Tokens / active min", compactDistributionValue(data.rows[0]))}
  </div>
  ${
    full
      ? `${renderDistributionCards(data.rows)}
  <details class="raw-details">
    <summary>Raw percentile table</summary>
    <table class="data-table">
      <thead><tr><th>Metric</th><th>Median</th><th>Mean</th><th>P75</th><th>P90</th><th>Max</th></tr></thead>
      <tbody>${data.rows
        .map(
          ({ label, summary }) =>
            `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(formatFloat(summary.median))}</td><td>${escapeHtml(formatFloat(summary.mean))}</td><td>${escapeHtml(formatFloat(summary.p75))}</td><td>${escapeHtml(formatFloat(summary.p90))}</td><td>${escapeHtml(formatFloat(summary.max))}</td></tr>`,
        )
        .join("")}</tbody>
    </table>
  </details>`
      : renderCompactDistributionCards(data.rows)
  }
</section>`;
}

function renderDailyBreakdown(rows: DailyBreakdownRow[]): string {
  const limited = rows.slice(0, 40);
  const note =
    rows.length > 40
      ? `<p class="panel-copy">Showing first ${limited.length} of ${rows.length} rows.</p>`
      : "";
  return `<section class="data-panel">
  <h2>Per-day / per-harness / per-model</h2>
  ${note}
  ${renderDailyVisuals(limited)}
  <details class="raw-details">
    <summary>Raw daily rows</summary>
    <table class="data-table dense">
      <thead><tr><th>Date</th><th>Harness</th><th>Sub</th><th>Model</th><th>Effort</th><th>Active</th><th>Sessions</th><th>Req</th><th>Fresh</th><th>Cached</th><th>Output</th><th>Reason</th></tr></thead>
      <tbody>${
        limited.length === 0
          ? '<tr><td colspan="12" class="empty">No rows</td></tr>'
          : limited
              .map(
                (row) =>
                  `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.harness)}</td><td>${escapeHtml(row.subharness)}</td><td>${escapeHtml(row.model)}</td><td>${escapeHtml(row.effort)}</td><td>${escapeHtml(humanSeconds(row.activeSeconds))}</td><td>${row.sessions}</td><td>${row.requests}</td><td>${escapeHtml(compactTokens(row.input))}</td><td>${escapeHtml(compactTokens(row.cached))}</td><td>${escapeHtml(compactTokens(row.output))}</td><td>${escapeHtml(displayTelemetry(row.reasoning, row.reasoningAvailability))}</td></tr>`,
              )
              .join("")
      }</tbody>
    </table>
  </details>
</section>`;
}

function renderDailyUsagePanel(report: BuiltReport, full: boolean): string {
  const rows = full ? report.dailyUsage.rows : report.dailyUsage.rows.slice(-7);
  return `<section class="data-panel">
  <h2>Per-day tokens and cost</h2>
  <div class="metric-grid">
    ${htmlMetricPair("Average", "Tokens/day", compactMetric(report.dailyUsage.avgTokens), "Cost/day", formatUsd(report.dailyUsage.avgCost))}
    ${htmlMetricPair("Active-day average", "Tokens", compactMetric(report.dailyUsage.activeDayAvgTokens), "Cost", formatUsd(report.dailyUsage.activeDayAvgCost))}
    ${htmlMetricPair("Median", "Tokens/day", compactMetric(report.dailyUsage.tokenMedian), "Cost/day", formatUsd(report.dailyUsage.costMedian))}
    ${htmlMetricPair("P90", "Tokens/day", compactMetric(report.dailyUsage.tokenP90), "Cost/day", formatUsd(report.dailyUsage.costP90))}
    ${htmlMetricPair("Volatility", "Tokens", formatPercent(report.dailyUsage.tokenVolatility), "Cost", formatPercent(report.dailyUsage.costVolatility))}
  </div>
  <table class="data-table dense">
    <thead><tr><th>Date</th><th>Active</th><th>Req</th><th>Tokens</th><th>Cost</th></tr></thead>
    <tbody>${
      rows.length === 0
        ? '<tr><td colspan="5" class="empty">No rows</td></tr>'
        : rows
            .map(
              (row) =>
                `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(humanSeconds(row.activeSeconds))}</td><td>${row.requestCount}</td><td>${escapeHtml(compactTokens(row.tokens))}</td><td>${escapeHtml(formatUsd(row.cost))}</td></tr>`,
            )
            .join("")
    }</tbody>
  </table>
</section>`;
}

function renderDailyStrip(report: BuiltReport): string {
  const days =
    report.scope === "today" ? 1 : report.scope === "1d" ? 2 : report.scope === "7d" ? 7 : 30;
  const start = new Date(report.generatedAt);
  start.setDate(start.getDate() - (days - 1));

  const values = Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = calendarDate(day);
    return { active: report.combined.stats.days[key]?.activeSeconds ?? 0, key };
  });
  const maxValue = Math.max(...values.map((value) => value.active), 1);

  return `<section class="activity-strip" aria-label="Daily active time">
  <div>
    <h2>Daily active trace</h2>
    <p>Rolling range, scaled to the busiest day in this report.</p>
  </div>
  <div class="bars">${values
    .map(
      (value) =>
        `<span title="${escapeHtml(`${value.key}: ${humanSeconds(value.active)}`)}" style="height:${Math.max(4, (value.active / maxValue) * 100)}%"></span>`,
    )
    .join("")}</div>
</section>`;
}

function renderRingChart(
  rows: ReadonlyArray<{ label: string; tone: string; value: number; valueLabel: string }>,
  total: number,
  caption: string,
): string {
  if (rows.length === 0 || total <= 0) {
    return '<p class="empty">No activity</p>';
  }

  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    cursor += (row.value / total) * 100;
    return `${row.tone} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  const ring = `conic-gradient(${stops.join(", ")})`;

  return `<div class="big-ring">
  <div class="ring" style="--ring:${escapeHtml(ring)}" aria-hidden="true"></div>
  <div>
    <p class="panel-copy">${escapeHtml(caption)} split across local stores.</p>
    ${renderBarList(rows, total, "No activity")}
  </div>
</div>`;
}

function renderBarList(
  rows: ReadonlyArray<{ label: string; tone: string; value: number; valueLabel: string }>,
  maxValue: number,
  emptyLabel: string,
): string {
  if (rows.length === 0) {
    return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  }

  const max = maxValue > 0 ? maxValue : 1;
  return `<ul class="bar-list">${rows
    .map((row) => {
      const width = Math.max(2, Math.min(100, (row.value / max) * 100));
      return `<li><div class="bar-head"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><b>${escapeHtml(row.valueLabel)}</b></div><div class="bar-track"><i style="--bar-tone:${escapeHtml(row.tone)};width:${width.toFixed(1)}%"></i></div></li>`;
    })
    .join("")}</ul>`;
}

function renderTokenStackList(
  rows: ReadonlyArray<{ label: string; tone: string; value: number }>,
): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.length === 0 || total <= 0) {
    return '<p class="empty">No token usage</p>';
  }

  const stack = rows
    .map((row) => {
      const width = stackPct(row.value, total);
      return `<i style="background:${escapeHtml(row.tone)};width:${width.toFixed(1)}%" title="${escapeHtml(`${row.label}: ${compactTokens(row.value)}`)}"></i>`;
    })
    .join("");
  const legend = rows
    .map(
      (row) =>
        `<li><div class="bar-head"><span>${escapeHtml(row.label)}</span><b>${escapeHtml(compactTokens(row.value))}</b></div><div class="bar-track"><i style="--bar-tone:${escapeHtml(row.tone)};width:${pct(row.value, total)}%"></i></div></li>`,
    )
    .join("");

  return `<div class="stack-track" title="${escapeHtml(`Total: ${compactTokens(total)}`)}">${stack}</div><ul class="token-stack-list">${legend}</ul>`;
}

function renderDistributionCards(rows: ReadonlyArray<RequestDistributionRow>): string {
  return `<div class="dist-grid">${rows
    .map(({ label, summary }) => {
      const max = Math.max(summary.max ?? 0, 1);
      const median = pct(summary.median, max);
      const p75 = pct(summary.p75, max);
      const p90 = pct(summary.p90, max);
      return `<section class="dist-card">
  <h3>${escapeHtml(label)}</h3>
  <div class="dist-head"><span>Median</span><b>${escapeHtml(formatFloat(summary.median))}</b></div>
  <div class="dist-track"><i style="width:${median}%"></i></div>
  <div class="dist-head"><span>P75</span><b>${escapeHtml(formatFloat(summary.p75))}</b></div>
  <div class="dist-track"><i style="width:${p75}%"></i></div>
  <div class="dist-head"><span>P90</span><b>${escapeHtml(formatFloat(summary.p90))}</b></div>
  <div class="dist-track"><i style="width:${p90}%"></i></div>
  <dl class="dist-values">
    <div><dt>Mean</dt><dd>${escapeHtml(formatFloat(summary.mean))}</dd></div>
    <div><dt>Median</dt><dd>${escapeHtml(formatFloat(summary.median))}</dd></div>
    <div><dt>P90</dt><dd>${escapeHtml(formatFloat(summary.p90))}</dd></div>
    <div><dt>Max</dt><dd>${escapeHtml(formatFloat(summary.max))}</dd></div>
  </dl>
</section>`;
    })
    .join("")}</div>`;
}

function renderDailyVisuals(rows: DailyBreakdownRow[]): string {
  if (rows.length === 0) {
    return '<p class="empty">No request-level rows in this range.</p>';
  }

  const activeMax = Math.max(...rows.map((row) => row.activeSeconds), 1);
  const sourceTotals = new Map<string, { tone: string; value: number }>();
  for (const row of rows) {
    const current = sourceTotals.get(row.harness) ?? {
      tone: sourceTone(row.harness),
      value: 0,
    };
    current.value += row.activeSeconds;
    sourceTotals.set(row.harness, current);
  }
  const sourceRows = [...sourceTotals.entries()]
    .map(([label, value]) => ({
      label,
      tone: value.tone,
      value: value.value,
      valueLabel: humanSeconds(value.value),
    }))
    .sort((a, b) => b.value - a.value);

  return `<div class="daily-viz">
  <section>
    <h3>Daily model rows</h3>
    <ul class="daily-card-list">${rows
      .slice(0, 12)
      .map((row) => {
        const activeWidth = pct(row.activeSeconds, activeMax);
        const total = row.input + row.cached + row.output + row.reasoning;
        return `<li class="daily-card">
  <strong title="${escapeHtml(`${row.date} · ${row.harness} · ${row.model}`)}">${escapeHtml(row.date)} · ${escapeHtml(row.harness)} · ${escapeHtml(row.model)}</strong>
  <small>${escapeHtml(row.subharness)} · ${escapeHtml(row.effort)} · ${row.requests} req · ${humanSeconds(row.activeSeconds)}</small>
  <div class="bar-track"><i style="--bar-tone:${escapeHtml(sourceTone(row.harness))};width:${activeWidth}%"></i></div>
  <div class="stack-track" title="${escapeHtml(`Fresh ${compactTokens(row.input)} · cached ${compactTokens(row.cached)} · output ${compactTokens(row.output)} · reasoning ${displayTelemetry(row.reasoning, row.reasoningAvailability)}`)}">
    <i class="stack-input" style="width:${stackPct(row.input, total).toFixed(1)}%"></i>
    <i class="stack-cached" style="width:${stackPct(row.cached, total).toFixed(1)}%"></i>
    <i class="stack-output" style="width:${stackPct(row.output, total).toFixed(1)}%"></i>
    <i class="stack-reasoning" style="width:${stackPct(row.reasoning, total).toFixed(1)}%"></i>
  </div>
</li>`;
      })
      .join("")}</ul>
  </section>
  <section>
    <h3>Harness active split</h3>
    ${renderBarList(sourceRows, Math.max(...sourceRows.map((row) => row.value), 1), "No activity")}
  </section>
</div>`;
}

function renderSimpleList(
  title: string,
  rows: ReadonlyArray<readonly [string, string]>,
  panelClass?: string,
): string {
  const body =
    rows.length === 0
      ? '<li class="empty">None</li>'
      : rows
          .map(
            ([name, value]) =>
              `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></li>`,
          )
          .join("");
  return `<section class="panel ${panelClass ?? ""}"><h4>${escapeHtml(title)}</h4><ul class="rank-list">${body}</ul></section>`;
}

function renderShareList(
  title: string,
  rows: ReadonlyArray<{ key: string; label: string; pct: number }>,
  emptyLabel: string,
): string {
  const body =
    rows.length === 0
      ? `<li class="empty">${escapeHtml(emptyLabel)}</li>`
      : rows
          .map(
            (row) =>
              `<li><div class="share-head"><span>${escapeHtml(row.key)}</span><b>${escapeHtml(row.label)}</b></div><div class="track"><i style="width:${Math.max(2, Math.min(100, row.pct)).toFixed(1)}%"></i></div></li>`,
          )
          .join("");
  return `<section class="panel"><h4>${escapeHtml(title)}</h4><ul class="share-list">${body}</ul></section>`;
}

function renderModelsPanel(
  rows: ReturnType<typeof modelRows>,
  section: SourceSection,
  pricing: Record<string, PricingInfo>,
  writeAvailability: ReturnType<typeof cacheWriteAvailability>,
): string {
  const effortBreakdowns = modelEffortBreakdownMap(section.sessions, pricing, rows.length);
  const reasonAvailability = reasoningAvailability(section.sessions);
  const workflowAttributions = workflowModelAttributions(section.sessions);
  const mixedUsage = mixedWorkflowUsage(section.sessions);
  const modelHtml =
    rows.length === 0
      ? '<li class="empty">No model markers</li>'
      : rows
          .map((row) => {
            const efforts = effortBreakdowns.get(row.key) ?? [];
            const rowAvailability = modelTelemetryAvailability(section, row.key);
            const modelAttributions = workflowAttributions.filter((item) => item.model === row.key);
            const unattributedHtml = row.tokensAttributed
              ? ""
              : `<div class="workflow-model-note"><strong>Observed workflow model</strong><span>${modelAttributions
                  .map(
                    (item) =>
                      `${item.effort} effort · ${item.agents} agent ${item.agents === 1 ? "session" : "sessions"}`,
                  )
                  .map(escapeHtml)
                  .join(
                    "<br>",
                  )}</span><small>Per-model token categories, active time, and cost are unavailable.</small></div>`;
            const effortHtml =
              efforts.length === 0
                ? ""
                : `<div class="effort-block"><div class="effort-head"><span>Effort-normalized</span><small>per request / per active minute, medium baseline</small></div><ul class="effort-list">${efforts
                    .map((effort) => {
                      const metrics = effortMetricCells(effort)
                        .map(
                          (metric) =>
                            `<div><dt>${escapeHtml(metric.label)}</dt><dd>${escapeHtml(formatEffortMetricValue(metric.kind, metric.value))}</dd><small>${escapeHtml(metric.note)}</small></div>`,
                        )
                        .join("");
                      const costMix = effortCostMix(effort)
                        .map((item) => `${item.label} ${formatUsd(item.value)}`)
                        .join(" · ");
                      return `<li><div class="effort-top"><strong>${escapeHtml(effort.effort)}</strong><span>${escapeHtml(`${effort.requests} req`)}</span></div><dl class="effort-metrics">${metrics}</dl><p class="effort-cost-split">Cost mix/req · ${escapeHtml(costMix)}</p></li>`;
                    })
                    .join("")}</ul></div>`;
            const metricsHtml = row.tokensAttributed
              ? `<dl class="model-metrics"><div><dt>Active time</dt><dd>${escapeHtml(humanSeconds(row.activeSeconds))}</dd><small>scope total</small></div><div><dt>Input</dt><dd>${escapeHtml(compactTokens(row.tokenInfo.input))}</dd><small>${escapeHtml(row.inputRate)}</small></div><div><dt>Cached</dt><dd>${escapeHtml(compactTokens(row.tokenInfo.cached))}</dd><small>cache read</small></div><div><dt>Write</dt><dd>${escapeHtml(displayCacheWrite(row.tokenInfo.cacheWrite, rowAvailability.cacheWrite))}</dd><small>${escapeHtml(availabilityNote(rowAvailability.cacheWrite, "cache create", "not exposed"))}</small></div><div><dt>Output</dt><dd>${escapeHtml(compactTokens(row.tokenInfo.output))}</dd><small>${escapeHtml(row.outputRate)}</small></div><div><dt>Reason</dt><dd>${escapeHtml(displayTelemetry(row.tokenInfo.reasoning, rowAvailability.reasoning))}</dd><small>${escapeHtml(availabilityNote(rowAvailability.reasoning, "separately reported", "not separately reported"))}</small></div><div><dt>Est cost</dt><dd>${escapeHtml(displayPartialCost(row.cost, rowAvailability.cacheWrite))}</dd><small>scope total</small></div></dl>`
              : "";
            return `<li class="model-row"><div class="model-top"><span title="${escapeHtml(row.key)}">${escapeHtml(row.key)}</span><b>${row.pct.toFixed(0)}% model share</b></div><div class="track"><i style="width:${Math.max(2, Math.min(100, row.pct)).toFixed(1)}%"></i></div>${metricsHtml}${unattributedHtml}${effortHtml}</li>`;
          })
          .join("");
  const mixedUsageHtml = mixedUsage
    ? `<section class="mixed-usage"><div class="mixed-usage-head"><div><strong>Combined mixed workflow usage</strong><small>${mixedUsage.requests} aggregate ${mixedUsage.requests === 1 ? "record" : "records"}</small></div><p>These totals apply collectively to the workflow models above and cannot be split by model.</p></div><dl class="model-metrics"><div><dt>Total</dt><dd>${escapeHtml(compactTokens(mixedUsage.tokenInfo.total))}</dd><small>all categories</small></div><div><dt>Input</dt><dd>${escapeHtml(compactTokens(mixedUsage.tokenInfo.input))}</dd><small>fresh input</small></div><div><dt>Cached</dt><dd>${escapeHtml(compactTokens(mixedUsage.tokenInfo.cached))}</dd><small>cache read</small></div><div><dt>Write</dt><dd>${escapeHtml(displayCacheWrite(mixedUsage.tokenInfo.cacheWrite, writeAvailability))}</dd><small>cache create</small></div><div><dt>Output</dt><dd>${escapeHtml(compactTokens(mixedUsage.tokenInfo.output))}</dd><small>reported output</small></div><div><dt>Reason</dt><dd>${escapeHtml(displayTelemetry(mixedUsage.tokenInfo.reasoning, reasonAvailability))}</dd><small>${escapeHtml(reasonAvailability === "unknown" ? "not separately reported" : reasonAvailability === "partial" ? "partially reported" : "separately reported")}</small></div><div><dt>Active time</dt><dd>${escapeHtml(humanSeconds(mixedUsage.activeSeconds))}</dd><small>combined scope</small></div></dl></section>`
    : "";
  return `<section class="panel-wide model-panel"><h4>Models</h4><ul class="model-list">${modelHtml}</ul>${mixedUsageHtml}</section>`;
}

function htmlMetric(label: string, value: string, note?: string): string {
  return `<div class="metric"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>${
    note ? `<span>${escapeHtml(note)}</span>` : ""
  }</div>`;
}

function htmlMetricPair(
  title: string,
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
): string {
  return `<section class="metric-pair"><h3>${escapeHtml(title)}</h3><dl><dt>${escapeHtml(
    leftLabel,
  )}</dt><dd>${escapeHtml(leftValue)}</dd><dt>${escapeHtml(rightLabel)}</dt><dd>${escapeHtml(
    rightValue,
  )}</dd></dl></section>`;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function htmlTokenBar(
  label: string,
  value: number,
  maxValue: number,
  cls: string,
  displayValue = compactTokens(value),
  note?: string,
): string {
  const width = maxValue <= 0 ? 0 : Math.max(2, Math.min(100, (value / maxValue) * 100));
  return `<div class="token-row ${escapeHtml(cls)}"><span>${escapeHtml(label)}</span><div class="track"><i style="width:${width.toFixed(1)}%"></i></div><b>${escapeHtml(displayValue)}</b>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
}

function displayCost(
  value: number | undefined,
  availability: "known" | "partial" | "unknown",
): string {
  return displayPartialCost(formatUsd(value), availability);
}

function pct(value: number | undefined, maxValue: number): string {
  if (value === undefined || maxValue <= 0) {
    return "0.0";
  }
  return Math.max(2, Math.min(100, (value / maxValue) * 100)).toFixed(1);
}

function stackPct(value: number, total: number): number {
  if (value <= 0 || total <= 0) {
    return 0;
  }
  return Math.max(2, (value / total) * 100);
}

function sourceTone(source: string): string {
  if (source === "codex") {
    return "var(--primary)";
  }
  if (source === "opencode") {
    return "var(--input)";
  }
  if (source === "claude") {
    return "oklch(0.72 0.1 50)";
  }
  if (source === "pi") {
    return "oklch(0.7 0.11 150)";
  }
  return "var(--cache)";
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function renderCompactDistributionCards(rows: ReadonlyArray<RequestDistributionRow>): string {
  return `<div class="dist-grid">
  ${rows
    .filter(
      (row) => row.label === "Tokens / active minute" || row.label === "Context size / request",
    )
    .map(
      (row) => `<article class="dist-card">
    <h3>${escapeHtml(row.label)}</h3>
    <div class="dist-values">
      <div><dt>Median</dt><dd>${escapeHtml(formatFloat(row.summary.median))}</dd></div>
      <div><dt>P90</dt><dd>${escapeHtml(formatFloat(row.summary.p90))}</dd></div>
      <div><dt>Mean</dt><dd>${escapeHtml(formatFloat(row.summary.mean))}</dd></div>
      <div><dt>Max</dt><dd>${escapeHtml(formatFloat(row.summary.max))}</dd></div>
    </div>
  </article>`,
    )
    .join("\n")}
</div>`;
}

function compactDistributionValue(row: RequestDistributionRow): string {
  const { summary } = row;
  return `${formatFloat(summary.median)} med · ${formatFloat(summary.p90)} p90`;
}

function averageMetric(total: number, count: number): string {
  return formatFloat(count > 0 ? total / count : undefined);
}

function formatContextMetric(value: number | undefined): string {
  return value === undefined ? "n/a" : compactTokens(Math.round(value));
}

function formatCacheRatio(value: number | undefined): string {
  return value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
