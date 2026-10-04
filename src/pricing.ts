import type { ModelTokenUsage, SessionRequest, TokenUsage } from "./domain.js";

const MODELS_DEV_URL = "https://models.dev/catalog.json";
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

    const providers = isRecord(payload.providers) ? payload.providers : payload;

    for (const [providerId, provider] of Object.entries(providers)) {
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

export type PricingInfo = {
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  completion?: number;
  prompt?: number;
};

export type CostBreakdown = {
  cacheWrite: number;
  cached: number;
  input: number;
  output: number;
  total: number;
};

/**
 * Prefers the provider that actually served the request, so subscriptions and gateways are
 * not priced at the model publisher's list rates and two providers offering the same model
 * stay distinguishable. Falls back to the publisher when the provider has no pricing entry.
 */
export function resolveModelId(
  modelName: string,
  pricing: Record<string, PricingInfo>,
  provider?: string,
): string {
  if (provider && Object.hasOwn(pricing, `${provider}/${modelName}`)) {
    return `${provider}/${modelName}`;
  }
  if (Object.hasOwn(pricing, modelName)) {
    return modelName;
  }

  const candidates = pricingCandidates(pricing).get(normalizeModelId(modelName)) ?? [];
  const providerMatch = provider
    ? candidates.find((candidate) => candidate.startsWith(`${provider}/`))
    : undefined;
  const publisher = canonicalPublisher(modelName);
  const publisherMatch = publisher
    ? candidates.find((candidate) => candidate.startsWith(`${publisher}/`))
    : undefined;

  return providerMatch ?? publisherMatch ?? (candidates.length === 1 ? candidates[0] : modelName);
}

export function estimateCostBreakdown(
  modelName: string,
  tokenInfo: ModelTokenUsage | TokenUsage,
  pricing: Record<string, PricingInfo>,
  provider?: string,
): CostBreakdown | undefined {
  const rates = pricing[resolveModelId(modelName, pricing, provider ?? tokenProvider(tokenInfo))];
  if (!rates) {
    return undefined;
  }

  const prompt = rates.prompt ?? 0;
  const completion = rates.completion ?? 0;
  const cacheRead = rates.cacheRead ?? 0;
  const cacheWrite = rates.cacheWrite ?? prompt;
  const cacheWrite1h = rates.cacheWrite1h ?? cacheWrite;
  const billableOutput =
    "billableOutput" in tokenInfo ? tokenInfo.billableOutput : tokenInfo.output;
  const input = tokenInfo.input * prompt;
  const cached = tokenInfo.cached * cacheRead;
  const oneHourWriteTokens = Math.min(tokenInfo.cacheWrite, tokenInfo.cacheWrite1h);
  const write =
    oneHourWriteTokens * cacheWrite1h + (tokenInfo.cacheWrite - oneHourWriteTokens) * cacheWrite;
  const output = billableOutput * completion;

  return {
    cacheWrite: write,
    cached,
    input,
    output,
    total: input + cached + write + output,
  };
}

export function estimateCost(
  modelName: string,
  tokenInfo: ModelTokenUsage | TokenUsage,
  pricing: Record<string, PricingInfo>,
  provider?: string,
): number | undefined {
  return estimateCostBreakdown(modelName, tokenInfo, pricing, provider)?.total;
}

function tokenProvider(tokenInfo: ModelTokenUsage | TokenUsage): string | undefined {
  return "provider" in tokenInfo ? tokenInfo.provider : undefined;
}

export function estimateStatsTotalCost(
  stats: { modelTokens: Record<string, ModelTokenUsage> },
  pricing: Record<string, PricingInfo>,
): number | undefined {
  let total = 0;
  let found = false;

  for (const [model, tokenInfo] of Object.entries(stats.modelTokens)) {
    const value = estimateCost(model, tokenInfo, pricing);
    if (value === undefined) {
      continue;
    }
    found = true;
    total += value;
  }

  return found ? total : undefined;
}

export function estimateRequestCost(
  request: Pick<
    SessionRequest,
    | "cacheRead"
    | "cacheWrite"
    | "cacheWrite1h"
    | "input"
    | "model"
    | "output"
    | "provider"
    | "reasoning"
  >,
  pricing: Record<string, PricingInfo> = {},
): number {
  return (
    estimateCost(
      request.model,
      {
        billableOutput: request.output + request.reasoning,
        cacheWrite: request.cacheWrite,
        cacheWrite1h: request.cacheWrite1h,
        cached: request.cacheRead,
        input: request.input,
        output: request.output,
        provider: request.provider,
        reasoning: request.reasoning,
        total:
          request.input +
          request.cacheRead +
          request.cacheWrite +
          request.output +
          request.reasoning,
      },
      pricing,
    ) ?? 0
  );
}

const PRICING_CANDIDATES = new WeakMap<Record<string, PricingInfo>, Map<string, string[]>>();

function pricingCandidates(pricing: Record<string, PricingInfo>): Map<string, string[]> {
  const cached = PRICING_CANDIDATES.get(pricing);
  if (cached) {
    return cached;
  }

  const candidates = new Map<string, string[]>();
  for (const modelId of Object.keys(pricing)) {
    const separator = modelId.indexOf("/");
    const unqualifiedId = separator >= 0 ? modelId.slice(separator + 1) : modelId;
    const normalized = normalizeModelId(unqualifiedId);
    candidates.set(normalized, [...(candidates.get(normalized) ?? []), modelId]);
  }
  PRICING_CANDIDATES.set(pricing, candidates);
  return candidates;
}

function normalizeModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replaceAll(".", "-")
    .replace(/:free$/, "-free");
}

function canonicalPublisher(modelId: string): string | undefined {
  const unqualifiedId = modelId.slice(modelId.lastIndexOf("/") + 1).toLowerCase();
  if (unqualifiedId.startsWith("claude-")) {
    return "anthropic";
  }
  if (/^(?:gpt-|o\d)/.test(unqualifiedId)) {
    return "openai";
  }
  return undefined;
}

export function weightedInputEquivalent(
  request: SessionRequest,
  pricing: Record<string, PricingInfo>,
): number | undefined {
  const rates = pricing[resolveModelId(request.model, pricing, request.provider)];
  if (!rates?.prompt) {
    return undefined;
  }

  const prompt = rates.prompt;
  const cacheReadWeight = rates.cacheRead === undefined ? 1 : rates.cacheRead / prompt;
  const cacheWriteWeight = rates.cacheWrite === undefined ? 1 : rates.cacheWrite / prompt;
  const cacheWrite1hWeight =
    rates.cacheWrite1h === undefined ? cacheWriteWeight : rates.cacheWrite1h / prompt;
  const oneHourWriteTokens = Math.min(request.cacheWrite, request.cacheWrite1h);

  return (
    request.input +
    request.cacheRead * cacheReadWeight +
    (request.cacheWrite - oneHourWriteTokens) * cacheWriteWeight +
    oneHourWriteTokens * cacheWrite1hWeight
  );
}
