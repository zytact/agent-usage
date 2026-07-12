import { writeFile } from "node:fs/promises";

import type { ReportMode } from "./args.js";
import { compactMetric, formatEffortMetricValue } from "./effort-format.js";
import { shouldShowSection } from "./render-shared.js";
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
  cacheWriteAvailability,
  effortCostMix,
  effortMetricCells,
  estimateStatsTotalCost,
  formatFloat,
  formatUsd,
  modelEffortBreakdowns,
  modelRows,
  percentRows,
  topEntries,
  type BuiltReport,
  type DailyBreakdownRow,
  type PricingInfo,
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

const REPORT_CSS = `:root {
  color-scheme: light dark;
  --bg: oklch(0.075 0 0);
  --surface: oklch(0.135 0.010 258);
  --surface-2: oklch(0.175 0.014 258);
  --line: oklch(0.285 0.020 258);
  --ink: oklch(0.940 0.010 258);
  --muted: oklch(0.720 0.018 258);
  --soft: oklch(0.560 0.030 258);
  --primary: oklch(0.681 0.132 258.4);
  --accent: oklch(0.760 0.150 70);
  --input: oklch(0.690 0.130 300);
  --cache: oklch(0.760 0.115 205);
  --output: oklch(0.780 0.145 82);
  --total: oklch(0.681 0.132 258.4);
  --track: oklch(0.205 0.018 258);
  --notice-bg: color-mix(in oklch, var(--surface), var(--accent) 11%);
  --grid-gap: 1px;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  margin: 0;
  background:
    radial-gradient(circle at 100% -8%, color-mix(in oklch, var(--primary), transparent 76%), transparent 26rem),
    radial-gradient(circle at 0% 0%, color-mix(in oklch, var(--accent), transparent 90%), transparent 18rem),
    var(--bg);
  color: var(--ink);
  font: 500 15px/1.55 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
main { width: min(1380px, calc(100% - 28px)); margin: 0 auto; padding: 24px 0 44px; }
code { font: inherit; }
.hero,
.summary-grid,
.activity-strip,
.data-panel,
.source-block,
.footer {
  border: 1px solid var(--line);
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
  gap: var(--grid-gap);
  background: var(--line);
}
.hero-main,
.hero-side { background: var(--surface); }
.hero-main { padding: 30px; }
.hero-side {
  display: grid;
  gap: var(--grid-gap);
  padding: 0;
  background: var(--line);
}
.hero-side div { background: var(--surface); padding: 18px; }
.eyebrow {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0;
}
h1 {
  margin: 0;
  font-size: 2.75rem;
  line-height: 1.02;
  letter-spacing: -0.025em;
  text-wrap: balance;
}
.hero-copy {
  max-width: 72ch;
  margin: 14px 0 0;
  color: var(--muted);
}
.hero-side p,
.panel-copy,
.footer p,
.activity-strip p,
.token-panel p {
  margin: 0;
  color: var(--muted);
}
.hero-side b,
.metric dd,
.source-head h2,
.model-metrics dd {
  font-variant-numeric: tabular-nums;
}
.hero-side b {
  display: block;
  margin-top: 5px;
  color: var(--ink);
  font-size: 1rem;
}
.summary-grid,
.source-head dl,
.request-grid,
.detail-grid,
.model-metrics {
  display: grid;
  gap: var(--grid-gap);
  background: var(--line);
}
.summary-grid {
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  margin-top: var(--grid-gap);
}
.metric {
  margin: 0;
  padding: 18px;
  background: var(--surface);
}
.metric dt {
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 700;
}
.metric dd {
  margin: 4px 0 0;
  color: var(--ink);
  font-size: 1.45rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.metric span {
  display: block;
  margin-top: 4px;
  color: var(--soft);
  font-size: 0.76rem;
}
.notice {
  margin: 18px 0 0;
  padding: 14px 16px;
  border: 1px solid color-mix(in oklch, var(--accent), var(--line) 60%);
  background: var(--notice-bg);
}
.activity-strip,
.data-panel,
.source-block,
.footer {
  margin-top: 24px;
  background: var(--surface);
}
.activity-strip {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 24px;
  align-items: end;
  padding: 22px 24px;
}
.activity-strip h2,
.data-panel h2,
.source-head h3,
.token-panel h3 {
  margin: 0 0 4px;
  font-size: 1rem;
}
.bars {
  display: flex;
  align-items: end;
  gap: 4px;
  height: 96px;
}
.bars span {
  flex: 1;
  min-width: 3px;
  background: var(--primary);
  opacity: 0.95;
}
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--grid-gap);
  margin-top: 1px;
  border: 1px solid var(--line);
  border-top: 0;
  background: var(--line);
}
.chart-panel {
  min-width: 0;
  padding: 22px 24px;
  background: var(--surface);
}
.chart-panel h2,
.chart-panel h3 {
  margin: 0 0 14px;
  font-size: 1rem;
}
.big-ring {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 20px;
  align-items: center;
}
.ring {
  display: grid;
  width: 150px;
  aspect-ratio: 1;
  place-items: center;
  border-radius: 50%;
  background: var(--ring);
}
.ring::after {
  width: 58%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--surface);
  content: "";
}
.bar-list,
.token-stack-list,
.dist-grid,
.daily-card-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.bar-list li,
.token-stack-list li,
.daily-card {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}
.bar-list li:first-child,
.token-stack-list li:first-child,
.daily-card:first-child { border-top: 0; padding-top: 0; }
.bar-head,
.dist-head,
.stack-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 7px;
}
.bar-head span,
.dist-head span,
.stack-head span {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar-track,
.dist-track,
.stack-track {
  height: 8px;
  overflow: hidden;
  background: var(--track);
}
.bar-track i,
.dist-track i {
  display: block;
  height: 100%;
  min-width: 2px;
  background: var(--bar-tone, var(--tone, var(--primary)));
}
.stack-track {
  display: flex;
}
.stack-track i {
  display: block;
  min-width: 2px;
  height: 100%;
}
.stack-input { background: var(--input); }
.stack-cached { background: var(--cache); }
.stack-output { background: var(--output); }
.stack-reasoning { background: var(--accent); }
.dist-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.dist-card {
  min-width: 0;
  padding: 14px;
  background: var(--surface-2);
}
.dist-card h3 {
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 0.86rem;
}
.dist-values {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 10px;
  background: var(--line);
}
.dist-values div {
  min-width: 0;
  padding: 8px;
  background: var(--surface);
}
.dist-values dt {
  color: var(--soft);
  font-size: 0.68rem;
}
.dist-values dd {
  margin: 1px 0 0;
  overflow: hidden;
  font-size: 0.86rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.daily-viz {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 0.42fr);
  gap: 1px;
  margin-top: 14px;
  background: var(--line);
}
.daily-viz > section {
  min-width: 0;
  padding: 18px;
  background: var(--surface-2);
}
.daily-card strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.daily-card small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
}
details.raw-details {
  margin-top: 14px;
}
details.raw-details summary {
  cursor: pointer;
  color: var(--muted);
  font-weight: 750;
}
.data-panel { padding: 22px 24px; }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin-top: 14px;
  background: var(--line);
}
.metric-pair {
  min-width: 0;
  padding: 14px 16px;
  background: var(--surface-2);
}
.metric-pair h3 {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 0.82rem;
}
.metric-pair dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px 12px;
  margin: 0;
}
.metric-pair dt {
  color: var(--soft);
  font-size: 0.74rem;
}
.metric-pair dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 750;
}
.request-grid { grid-template-columns: repeat(4, minmax(140px, 1fr)); }
.request-grid .metric { background: var(--surface-2); }
.data-table {
  width: 100%;
  margin-top: 14px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.data-table th,
.data-table td {
  padding: 9px 10px;
  border-top: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
.data-table thead th {
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 700;
}
.data-table tbody th { font-weight: 700; }
.data-table.dense th,
.data-table.dense td { font-size: 0.88rem; padding: 7px 8px; }
.source-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  background: var(--line);
}
.source-head > div,
.source-head dl { background: color-mix(in oklch, var(--surface), var(--tone) 8%); }
.source-head > div { padding: 24px; }
.source-head h2 {
  margin: 0;
  font-size: 2rem;
  line-height: 1.05;
  letter-spacing: -0.025em;
}
.source-head h3 {
  color: var(--tone);
  font-size: 0.82rem;
  font-weight: 700;
}
.source-head dl { grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
.source-head .metric { background: transparent; }
.token-panel { padding: 22px 24px; border-top: 1px solid var(--line); }
.token-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 78px;
  gap: 14px;
  align-items: center;
  margin-top: 10px;
}
.token-row span { color: var(--muted); }
.token-row b { text-align: right; }
.track {
  height: 10px;
  overflow: hidden;
  background: var(--track);
}
.track i { display: block; height: 100%; min-width: 2px; background: var(--tone); }
.token-row.input i { background: var(--input); }
.token-row.cached i { background: var(--cache); }
.token-row.output i { background: var(--output); }
.token-row.total i { background: var(--total); }
.token-row.reasoning i { background: var(--accent); }
.detail-grid { margin-top: 1px; }
.detail-grid-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.detail-grid-full {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.panel,
.panel-wide {
  min-width: 0;
  padding: 18px;
  background: var(--surface-2);
}
.panel h4,
.panel-wide h4 {
  margin: 0 0 12px;
  font-size: 0.92rem;
}
.detail-grid-summary .model-panel,
.detail-grid-summary .daily-panel,
.detail-grid-full .model-panel,
.detail-grid-full .language-panel,
.detail-grid-full .daily-panel {
  grid-column: span 2;
}
.rank-list,
.share-list,
.model-list { list-style: none; margin: 0; padding: 0; }
.rank-list li,
.share-list li,
.model-row {
  padding: 9px 0;
  border-top: 1px solid var(--line);
}
.rank-list li:first-child,
.share-list li:first-child,
.model-row:first-child { border-top: 0; padding-top: 0; }
.rank-list li {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}
.rank-list span,
.share-head span,
.model-top span,
.model-metrics small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-list span,
.share-head span,
.model-top span { color: var(--muted); }
.rank-list b,
.share-head b,
.model-top b { font-weight: 750; }
.share-head,
.model-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.share-list .track { height: 6px; }
.model-panel { background: color-mix(in oklch, var(--surface-2), var(--tone) 8%); }
.model-list .track { height: 7px; margin-bottom: 10px; }
.model-metrics { grid-template-columns: repeat(7, minmax(0, 1fr)); }
.model-metrics div { padding: 9px 10px; background: var(--surface); }
.effort-block {
  margin-top: 12px;
  padding: 12px;
  background: color-mix(in oklch, var(--surface), var(--tone) 6%);
  border: 1px solid var(--line);
}
.effort-head,
.effort-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.effort-head { margin-bottom: 10px; }
.effort-head span,
.effort-top span { color: var(--muted); }
.effort-head small { color: var(--soft); }
.effort-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.effort-list li { padding-top: 10px; border-top: 1px solid var(--line); }
.effort-list li:first-child { padding-top: 0; border-top: 0; }
.effort-metrics { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 10px; margin-top: 8px; }
.effort-metrics div { padding: 8px 9px; background: var(--surface); }
.effort-cost-split { margin: 8px 0 0; color: var(--soft); font-size: 0.72rem; }
.model-metrics dt,
.effort-metrics dt {
  margin: 0;
  color: var(--soft);
  font-size: 0.72rem;
}
.model-metrics dd,
.effort-metrics dd {
  margin: 2px 0 0;
  font-weight: 800;
}
.model-metrics small,
.effort-metrics small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: 0.7rem;
}
.empty { color: var(--soft); }
.footer { padding: 18px 24px; }
.footer p + p { margin-top: 8px; }
@media (max-width: 980px) {
  .hero,
  .activity-strip,
  .source-head,
  .chart-grid,
  .big-ring,
  .daily-viz { grid-template-columns: 1fr; }
  .summary-grid,
  .request-grid,
  .source-head dl,
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detail-grid,
  .detail-grid-summary,
  .detail-grid-full { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detail-grid-summary .model-panel,
  .detail-grid-summary .daily-panel,
  .detail-grid-full .model-panel,
  .detail-grid-full .language-panel,
  .detail-grid-full .daily-panel {
    grid-column: span 1;
  }
}
@media (max-width: 760px) {
  main { width: min(100% - 20px, 1380px); padding-top: 10px; }
  h1 { font-size: 2rem; }
  .summary-grid,
  .request-grid,
  .metric-grid,
  .metric-pair,
  .source-head dl,
  .model-metrics,
  .effort-metrics,
  .detail-grid,
  .detail-grid-summary,
  .detail-grid-full,
  .dist-grid,
  .dist-values { grid-template-columns: 1fr; }
  .token-row { grid-template-columns: 74px minmax(0, 1fr) 62px; gap: 10px; }
}
:root {
  --bg: oklch(0.085 0.003 265);
  --canvas: oklch(0.105 0.004 265);
  --surface: oklch(0.14 0.005 265);
  --surface-2: oklch(0.18 0.006 265);
  --line: oklch(0.31 0.009 265);
  --line-soft: color-mix(in oklch, var(--line), transparent 42%);
  --ink: oklch(0.96 0.006 24);
  --muted: oklch(0.73 0.008 265);
  --soft: oklch(0.59 0.01 265);
  --primary: oklch(0.68 0.21 24);
  --primary-soft: oklch(0.74 0.14 24);
  --accent: oklch(0.79 0.14 82);
  --input: oklch(0.72 0.16 5);
  --cache: oklch(0.76 0.12 205);
  --output: oklch(0.79 0.14 82);
  --total: oklch(0.68 0.21 24);
  --track: oklch(0.225 0.02 24);
  --notice-bg: color-mix(in oklch, var(--surface), var(--accent) 9%);
  --radius-control: 0;
  --radius-surface: 0;
  --radius-feature: 0;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}
html { background: var(--bg); }
body {
  min-width: 320px;
  background:
    radial-gradient(ellipse 34% 22rem at 18% -8rem, color-mix(in oklch, var(--primary), transparent 88%), transparent),
    linear-gradient(180deg, var(--bg), var(--canvas) 32rem, var(--bg));
  font-weight: 450;
  font-feature-settings: "tnum" 1, "cv02" 1, "cv03" 1, "cv04" 1;
}
main {
  width: min(1180px, calc(100% - 48px));
  padding: 42px 0 64px;
}
.hero,
.summary-grid,
.activity-strip,
.data-panel,
.source-block,
.footer {
  border-color: var(--line-soft);
  border-radius: var(--radius-surface);
}
.hero {
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.72fr);
  gap: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 7% 4%, color-mix(in oklch, var(--primary), transparent 88%), transparent 15rem),
    var(--surface);
}
.hero-main,
.hero-side,
.hero-side div { background: transparent; }
.hero-main {
  display: flex;
  min-height: 310px;
  flex-direction: column;
  justify-content: end;
  padding: 44px 46px;
}
.hero-side {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: end;
  gap: 0;
  border-left: 1px solid var(--line-soft);
  background: color-mix(in oklch, var(--surface), var(--bg) 18%);
}
.hero-side div {
  min-width: 0;
  padding: 20px;
  border-top: 1px solid var(--line-soft);
}
.hero-side div:nth-child(odd) { border-right: 1px solid var(--line-soft); }
.eyebrow {
  display: flex;
  gap: 9px;
  align-items: center;
  margin-bottom: 22px;
  color: var(--muted);
  font-size: 0.78rem;
}
.eyebrow::before {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  content: "";
}
h1 {
  max-width: 13ch;
  font-size: 3.75rem;
  font-weight: 650;
  letter-spacing: -0.035em;
}
.hero-copy {
  max-width: 62ch;
  margin-top: 22px;
  color: color-mix(in oklch, var(--muted), var(--ink) 8%);
  text-wrap: pretty;
}
.hero-side p { font-size: 0.75rem; }
.hero-side b {
  margin-top: 7px;
  overflow: hidden;
  font-size: 0.95rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  overflow: hidden;
  margin-top: 12px;
  background: var(--surface);
}
.summary-grid .metric {
  border-left: 1px solid var(--line-soft);
  background: transparent;
}
.summary-grid .metric:first-child { border-left: 0; }
.metric { padding: 20px; }
.metric dt {
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 600;
}
.metric dd {
  margin-top: 7px;
  font-size: 1.65rem;
  font-weight: 680;
  letter-spacing: -0.025em;
}
.metric span { color: var(--soft); }
.notice {
  border-color: color-mix(in oklch, var(--accent), transparent 62%);
  border-radius: var(--radius-control);
}
.activity-strip,
.data-panel,
.source-block,
.footer { margin-top: 12px; }
.activity-strip {
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 30px;
  overflow: hidden;
  padding: 24px 26px;
  background: var(--surface);
}
.activity-strip h2,
.data-panel h2,
.source-head h3,
.token-panel h3,
.chart-panel h2,
.chart-panel h3 {
  font-weight: 650;
  letter-spacing: -0.012em;
}
.bars { gap: 5px; height: 88px; }
.bars span {
  border-radius: 0;
  background: linear-gradient(180deg, var(--primary-soft), var(--primary));
}
.chart-grid {
  gap: 0;
  overflow: hidden;
  margin-top: 12px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-surface);
  background: var(--line-soft);
}
.chart-panel {
  border: 0;
  border-radius: 0;
  background: var(--surface);
}
.chart-panel + .chart-panel { border-left: 1px solid var(--line-soft); }
.chart-panel h2,
.chart-panel h3 { margin-bottom: 18px; }
.ring {
  background: var(--ring);
  filter: saturate(0.9);
}
.ring::after { background: var(--surface); }
.bar-list li,
.token-stack-list li,
.daily-card,
.rank-list li,
.share-list li,
.model-row { border-color: var(--line-soft); }
.bar-track,
.dist-track,
.stack-track,
.track { border-radius: 0; }
.bar-track i,
.dist-track i,
.stack-track i,
.track i { border-radius: inherit; }
.dist-grid { gap: 10px; }
.dist-card,
.metric-pair,
.panel,
.panel-wide {
  border: 0;
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.dist-card { padding: 16px; }
.dist-values {
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-control);
  background: transparent;
}
.dist-values div {
  border-left: 1px solid var(--line-soft);
  background: color-mix(in oklch, var(--surface), var(--surface-2) 48%);
}
.dist-values div:first-child { border-left: 0; }
.daily-viz {
  gap: 10px;
  background: transparent;
}
.daily-viz > section {
  border-radius: 0;
  background: var(--surface-2);
}
details.raw-details {
  margin-top: 16px;
  border-radius: var(--radius-control);
  transition: background 180ms var(--ease-out);
}
details.raw-details:hover { background: var(--surface-2); }
details.raw-details summary {
  padding: 10px 12px;
  border-radius: inherit;
  font-weight: 600;
}
details.raw-details summary:focus-visible {
  outline: 2px solid var(--input);
  outline-offset: 2px;
}
.data-panel {
  overflow-x: auto;
  padding: 24px 26px;
  background: var(--surface);
}
.metric-grid {
  gap: 10px;
  background: transparent;
}
.metric-pair { padding: 16px 18px; }
.request-grid {
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 0;
  background: transparent;
}
.request-grid .metric {
  border-left: 1px solid var(--line-soft);
  background: var(--surface-2);
}
.request-grid .metric:first-child { border-left: 0; }
.data-table {
  overflow: hidden;
  border-radius: var(--radius-control);
}
.data-table th,
.data-table td { border-color: var(--line-soft); }
.data-table thead { background: var(--surface-2); }
.data-table thead th {
  padding-top: 11px;
  padding-bottom: 11px;
  color: color-mix(in oklch, var(--muted), var(--ink) 10%);
}
.data-table tbody tr { transition: background 180ms var(--ease-out); }
.data-table tbody tr:hover { background: color-mix(in oklch, var(--surface-2), transparent 30%); }
.source-block {
  overflow: hidden;
  background: var(--surface);
}
.source-head {
  grid-template-columns: minmax(0, 1fr) minmax(400px, 0.9fr);
  gap: 0;
  background: var(--surface);
}
.source-head > div,
.source-head dl { background: transparent; }
.source-head > div {
  display: flex;
  min-height: 168px;
  flex-direction: column;
  justify-content: end;
  padding: 26px;
}
.source-head h2 {
  font-size: 2.2rem;
  font-weight: 650;
  letter-spacing: -0.035em;
}
.source-head h3 {
  color: color-mix(in oklch, var(--tone), var(--ink) 18%);
}
.source-head dl {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border-left: 1px solid var(--line-soft);
}
.source-head .metric {
  border-top: 1px solid var(--line-soft);
  border-left: 1px solid var(--line-soft);
}
.source-head .metric:nth-child(odd) { border-left: 0; }
.source-head .metric:nth-child(-n + 2) { border-top: 0; }
.token-panel {
  padding: 24px 26px;
  border-color: var(--line-soft);
}
.detail-grid {
  gap: 1px;
  padding: 1px 0 0;
  border-top: 1px solid var(--line-soft);
  background: color-mix(in oklch, var(--surface), var(--bg) 12%);
}
.model-panel { background: var(--surface-2); }
.model-metrics { gap: 6px; background: transparent; }
.model-metrics div,
.effort-metrics div {
  border-radius: 0;
  background: color-mix(in oklch, var(--surface), var(--surface-2) 44%);
}
.effort-block {
  border-color: var(--line-soft);
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--surface), var(--tone) 4%);
}
.footer {
  padding: 22px 24px;
  background: color-mix(in oklch, var(--surface), var(--bg) 24%);
}
.footer code {
  padding: 2px 5px;
  border-radius: 0;
  background: var(--surface-2);
  color: color-mix(in oklch, var(--muted), var(--ink) 12%);
}
@media (max-width: 980px) {
  .hero,
  .activity-strip,
  .source-head,
  .chart-grid,
  .big-ring,
  .daily-viz { grid-template-columns: 1fr; }
  .hero-main { min-height: 250px; }
  .hero-side {
    border-top: 1px solid var(--line-soft);
    border-left: 0;
  }
  .source-head dl {
    border-top: 1px solid var(--line-soft);
    border-left: 0;
  }
  .chart-panel + .chart-panel {
    border-top: 1px solid var(--line-soft);
    border-left: 0;
  }
}
@media (max-width: 760px) {
  main { width: min(100% - 20px, 1180px); padding: 10px 0 30px; }
  .hero-main { min-height: 235px; padding: 28px 24px; }
  h1 { font-size: 2.6rem; }
  .hero-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .summary-grid .metric:nth-child(odd) { border-left: 0; }
  .summary-grid .metric:nth-child(n + 3) { border-top: 1px solid var(--line-soft); }
  .request-grid .metric {
    border-top: 1px solid var(--line-soft);
    border-left: 0;
  }
  .request-grid .metric:first-child { border-top: 0; }
  .data-panel,
  .chart-panel,
  .token-panel { padding: 20px; }
  .source-head > div { min-height: 130px; padding: 22px; }
  .source-head h2 { font-size: 1.8rem; }
  .dist-values div {
    border-top: 1px solid var(--line-soft);
    border-left: 0;
  }
  .dist-values div:first-child { border-top: 0; }
}
@media (max-width: 440px) {
  .source-head dl { grid-template-columns: 1fr; }
  .source-head .metric,
  .source-head .metric:nth-child(-n + 2) {
    border-top: 1px solid var(--line-soft);
    border-left: 0;
    border-right: 0;
  }
  .source-head .metric:first-child { border-top: 0; }
  h1 { font-size: 2.25rem; }
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: oklch(0.955 0.004 265);
    --canvas: oklch(0.982 0.003 265);
    --surface: oklch(0.995 0.002 265);
    --surface-2: oklch(0.935 0.006 265);
    --line: oklch(0.70 0.012 265);
    --line-soft: color-mix(in oklch, var(--line), transparent 28%);
    --ink: oklch(0.205 0.012 265);
    --muted: oklch(0.405 0.018 265);
    --soft: oklch(0.47 0.022 265);
    --primary: oklch(0.54 0.20 24);
    --primary-soft: oklch(0.63 0.16 24);
    --accent: oklch(0.53 0.13 72);
    --input: oklch(0.54 0.17 5);
    --cache: oklch(0.50 0.105 205);
    --output: oklch(0.53 0.13 72);
    --total: oklch(0.54 0.20 24);
    --track: oklch(0.87 0.018 24);
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}`;

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
  const combinedCost = estimateStatsTotalCost(report.combined.stats, pricing);
  return `<dl class="summary-grid" aria-label="Combined summary">
    ${htmlMetric("Active time", humanSeconds(report.combined.stats.activeSeconds))}
    ${htmlMetric("Sessions", String(report.combined.stats.sessionCount))}
    ${htmlMetric("Tokens", compactTokens(report.combined.stats.tokens.total), "provider total when present")}
    ${htmlMetric("Estimated cost", formatUsd(combinedCost), "models.dev rate card when available")}
  </dl>`;
}

function renderNoDataNotice(report: BuiltReport): string {
  return report.combined.stats.sessionCount === 0
    ? '<p class="notice">No sessions found in this range.</p>'
    : "";
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
  const models = modelRows(stats, pricing, 5);
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
      ${htmlMetric("Est cost", formatUsd(costs))}
    </dl>
  </header>
  <section class="token-panel">
    <h3>Token intensity</h3>
    <p>Total uses provider total when present, else input plus cached plus cache write plus output plus reasoning.</p>
    ${htmlTokenBar("Input", stats.tokens.input, tokenTotal, "input")}
    ${htmlTokenBar("Cached", stats.tokens.cached, tokenTotal, "cached")}
    ${htmlTokenBar("Cache write", stats.tokens.cacheWrite, tokenTotal, "cache-write", displayCacheWrite(stats.tokens.cacheWrite, writeAvailability), writeAvailability === "unknown" ? "not exposed by source" : undefined)}
    ${htmlTokenBar("Output", stats.tokens.output, tokenTotal, "output")}
    ${htmlTokenBar("Reasoning", stats.tokens.reasoning, tokenTotal, "reasoning")}
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
  const modelMix = modelRows(report.combined.stats, pricing, 6).map((row) => ({
    label: row.key,
    tone: "var(--primary)",
    value: row.pct,
    valueLabel: `${row.pct.toFixed(0)}%`,
  }));
  const costRows = report.sections
    .filter((section) => section.kind === "primary")
    .map((section) => ({
      label: section.title,
      tone: section.tone,
      value: estimateStatsTotalCost(section.stats, pricing) ?? 0,
      valueLabel: formatUsd(estimateStatsTotalCost(section.stats, pricing)),
    }))
    .filter((row) => row.value > 0);
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
    ${renderBarList(costRows, Math.max(...costRows.map((row) => row.value), 1), "No priced usage")}
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
    <h2>Model request mix</h2>
    ${renderBarList(modelMix, 100, "No model markers")}
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
                  `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.harness)}</td><td>${escapeHtml(row.subharness)}</td><td>${escapeHtml(row.model)}</td><td>${escapeHtml(row.effort)}</td><td>${escapeHtml(humanSeconds(row.activeSeconds))}</td><td>${row.sessions}</td><td>${row.requests}</td><td>${escapeHtml(compactTokens(row.input))}</td><td>${escapeHtml(compactTokens(row.cached))}</td><td>${escapeHtml(compactTokens(row.output))}</td><td>${escapeHtml(compactTokens(row.reasoning))}</td></tr>`,
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
    const key = day.toISOString().slice(0, 10);
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

  const max = Math.max(maxValue, 1);
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
  <div class="stack-track" title="${escapeHtml(`Fresh ${compactTokens(row.input)} · cached ${compactTokens(row.cached)} · output ${compactTokens(row.output)} · reasoning ${compactTokens(row.reasoning)}`)}">
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
  const effortBreakdowns = new Map(
    modelEffortBreakdowns(section.sessions, pricing, rows.length).map((row) => [
      row.model,
      row.effortRows,
    ]),
  );
  const body =
    rows.length === 0
      ? '<li class="empty">No model markers</li>'
      : rows
          .map((row) => {
            const efforts = effortBreakdowns.get(row.key) ?? [];
            const effortHtml =
              efforts.length === 0
                ? ""
                : `<div class="effort-block"><div class="effort-head"><span>Effort-normalized</span><small>per request / per active min, medium baseline</small></div><ul class="effort-list">${efforts
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
            return `<li class="model-row"><div class="model-top"><span title="${escapeHtml(row.key)}">${escapeHtml(row.key)}</span><b>${row.pct.toFixed(0)}%</b></div><div class="track"><i style="width:${Math.max(2, Math.min(100, row.pct)).toFixed(1)}%"></i></div><dl class="model-metrics"><div><dt>Time</dt><dd>${escapeHtml(humanSeconds(row.activeSeconds))}</dd><small>range total</small></div><div><dt>Input</dt><dd>${escapeHtml(compactTokens(row.tokenInfo.input))}</dd><small>${escapeHtml(row.inputRate)}</small></div><div><dt>Cached</dt><dd>${escapeHtml(compactTokens(row.tokenInfo.cached))}</dd><small>cache read</small></div><div><dt>Write</dt><dd>${escapeHtml(displayCacheWrite(row.tokenInfo.cacheWrite, writeAvailability))}</dd><small>${escapeHtml(writeAvailability === "unknown" ? "not exposed" : "cache create")}</small></div><div><dt>Output</dt><dd>${escapeHtml(compactTokens(row.tokenInfo.output))}</dd><small>${escapeHtml(row.outputRate)}</small></div><div><dt>Reason</dt><dd>${escapeHtml(compactTokens(row.tokenInfo.reasoning))}</dd><small>thinking</small></div><div><dt>Est cost</dt><dd>${escapeHtml(row.cost)}</dd><small>range total</small></div></dl>${effortHtml}</li>`;
          })
          .join("");
  return `<section class="panel-wide model-panel"><h4>Models</h4><ul class="model-list">${body}</ul></section>`;
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

function displayCacheWrite(
  value: number,
  availability: ReturnType<typeof cacheWriteAvailability>,
): string {
  return availability === "unknown" ? "n/a" : compactTokens(value);
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
