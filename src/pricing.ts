import type { PricingInfo } from "./report-data.js";

const MODELS_DEV_URL = "https://models.dev/api.json";
const TOKENS_PER_MILLION = 1_000_000;

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
    const out: Record<string, PricingInfo> = {};

    if (!isRecord(payload)) {
      return out;
    }

    for (const [providerId, provider] of Object.entries(payload)) {
      if (!isRecord(provider) || !isRecord(provider.models)) {
        continue;
      }

      for (const [modelId, model] of Object.entries(provider.models)) {
        if (!isRecord(model) || !isRecord(model.cost)) {
          continue;
        }

        out[`${providerId}/${modelId}`] = pricingInfo(providerId, model.cost);
      }
    }

    return out;
  } catch {
    return {};
  }
}

function pricingInfo(providerId: string, cost: Record<string, unknown>): PricingInfo {
  const prompt = perToken(cost.input);
  return {
    cacheRead: perToken(cost.cache_read),
    cacheWrite: perToken(cost.cache_write),
    ...(providerId === "anthropic" && prompt !== undefined ? { cacheWrite1h: prompt * 2 } : {}),
    completion: perToken(cost.output),
    prompt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function perToken(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num / TOKENS_PER_MILLION : undefined;
}
