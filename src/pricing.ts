import type { PricingInfo } from "./report-data.js";

const MODELS_DEV_URL = "https://raw.githubusercontent.com/anomalyco/models.dev/dev/models.json";

export async function loadPricingMap(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, PricingInfo>> {
  try {
    const response = await fetchImpl(MODELS_DEV_URL, {
      headers: { "user-agent": "agent-usage" },
    });
    if (!response.ok) {
      return {};
    }

    const payload: unknown = await response.json();
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    const out: Record<string, PricingInfo> = {};

    for (const item of data) {
      if (!isRecord(item)) {
        continue;
      }
      const pricing = isRecord(item.pricing) ? item.pricing : {};
      const id = asString(item.id);
      if (!id) {
        continue;
      }
      out[id] = {
        cacheRead: asNumber(pricing.input_cache_read),
        cacheWrite: asNumber(pricing.input_cache_write),
        completion: asNumber(pricing.completion),
        prompt: asNumber(pricing.prompt),
      };
    }

    return out;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}
