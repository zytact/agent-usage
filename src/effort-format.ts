import { compactTokens, humanSeconds } from "./report-core.js";
import { formatUsd } from "./report-data.js";

export function compactMetric(value: number | undefined): string {
  return value === undefined ? "n/a" : compactTokens(Math.round(value));
}

function formatDurationMetric(value: number | undefined): string {
  return value === undefined ? "n/a" : humanSeconds(Math.round(value));
}

function formatUsdMetric(value: number | undefined): string {
  if (value !== undefined && value >= 0.01 && value < 0.9995) {
    return `$${value.toFixed(3)}`;
  }
  return formatUsd(value);
}

export function formatEffortMetricValue(
  kind: "duration" | "tokens" | "usd",
  value: number | undefined,
): string {
  if (kind === "usd") {
    return formatUsdMetric(value);
  }
  if (kind === "duration") {
    return formatDurationMetric(value);
  }
  return compactMetric(value);
}
