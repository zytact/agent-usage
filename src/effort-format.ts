import { compactTokens, humanSeconds } from "./report-core.js";
import { formatUsd } from "./report-data.js";

export function compactMetric(value: number | undefined): string {
  return value === undefined ? "n/a" : compactTokens(Math.round(value));
}

function formatDurationMetric(value: number | undefined): string {
  return value === undefined ? "n/a" : humanSeconds(Math.round(value));
}

export function formatEffortMetricValue(
  kind: "duration" | "tokens" | "usd",
  value: number | undefined,
): string {
  if (kind === "usd") {
    return formatUsd(value);
  }
  if (kind === "duration") {
    return formatDurationMetric(value);
  }
  return compactMetric(value);
}
