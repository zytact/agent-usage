export const REPORT_CSS = `:root {
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
.workflow-model-note {
  display: grid;
  grid-template-columns: minmax(160px, 0.7fr) minmax(180px, 1fr) minmax(240px, 1.3fr);
  gap: 10px 18px;
  align-items: baseline;
  padding: 11px 12px;
  background: var(--surface);
}
.workflow-model-note strong { font-size: 0.78rem; }
.workflow-model-note span { color: var(--muted); font-size: 0.78rem; }
.workflow-model-note small { color: var(--soft); font-size: 0.72rem; }
.mixed-usage {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.mixed-usage-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 10px 24px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.mixed-usage-head div { display: grid; gap: 2px; }
.mixed-usage-head strong { font-size: 0.9rem; }
.mixed-usage-head small,
.mixed-usage-head p { color: var(--soft); font-size: 0.72rem; }
.mixed-usage-head p { max-width: 60ch; margin: 0; }
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
  .workflow-model-note,
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
