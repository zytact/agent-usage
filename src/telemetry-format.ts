import type { TelemetryAvailability } from "./domain.js";
import { compactTokens } from "./report-core.js";

export function availabilityNote(
  availability: TelemetryAvailability,
  known: string,
  unknown: string,
): string {
  if (availability === "unknown") {
    return unknown;
  }
  return availability === "partial" ? "partially reported" : known;
}

export function displayPartialCost(value: string, availability: TelemetryAvailability): string {
  return availability !== "known" && value !== "n/a" ? `${value} (partial)` : value;
}

export function displayTelemetry(value: number, availability: TelemetryAvailability): string {
  if (availability === "unknown") {
    return "n/a";
  }
  const rendered = compactTokens(value);
  return availability === "partial" ? `${rendered} (partial)` : rendered;
}
