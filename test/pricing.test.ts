import { describe, expect, it } from "vite-plus/test";

import type { PricingInfo } from "../src/report-data.js";
import {
  estimateCost,
  estimateCostBreakdown,
  estimateStatsTotalCost,
  estimateWeightedInputEquivalent,
  formatUsd,
  formatUsdPerMillion,
  resolveModelId,
  summarizeRequestCache,
} from "../src/report-data.js";
import { loadPricingMap } from "../src/pricing.js";
import { aggregateSessions } from "../src/report-data.js";
import { makeRequest, makeSession } from "./fixtures.js";

describe("pricing", () => {
  it("loads current models.dev rates and converts per-million costs to per-token rates", async () => {
    const pricing = await loadPricingMap(
      async () =>
        new Response(
          JSON.stringify({
            openai: {
              models: {
                "gpt-5.6-sol": {
                  cost: {
                    cache_read: 0.5,
                    cache_write: 6.25,
                    input: 5,
                    output: 30,
                  },
                },
              },
            },
          }),
        ),
    );

    expect(pricing).toEqual({
      "openai/gpt-5.6-sol": {
        cacheRead: 0.0000005,
        cacheWrite: 0.00000625,
        completion: 0.00003,
        prompt: 0.000005,
      },
    });
  });

  it("derives Anthropic one-hour cache-write pricing from the documented multiplier", async () => {
    const pricing = await loadPricingMap(
      async () =>
        new Response(
          JSON.stringify({
            anthropic: {
              models: {
                "claude-opus-5": {
                  cost: {
                    cache_read: 0.5,
                    cache_write: 6.25,
                    input: 5,
                    output: 25,
                  },
                },
              },
            },
          }),
        ),
    );

    expect(pricing["anthropic/claude-opus-5"]?.cacheWrite1h).toBe(0.00001);
  });

  it("uses dynamic model resolution and billable output for cost breakdown", () => {
    const pricing: Record<string, PricingInfo> = {
      "openai/gpt-5.4": {
        cacheRead: 0.5,
        cacheWrite: 2,
        completion: 3,
        prompt: 1,
      },
    };

    const cost = estimateCostBreakdown(
      "gpt-5.4",
      {
        billableOutput: 11,
        cacheWrite: 7,
        cacheWrite1h: 0,
        cached: 5,
        input: 10,
        output: 13,
        reasoning: 2,
        total: 37,
      },
      pricing,
    );

    expect(resolveModelId("gpt-5.4", pricing)).toBe("openai/gpt-5.4");
    expect(cost).toEqual({
      cacheWrite: 14,
      cached: 2.5,
      input: 10,
      output: 33,
      total: 59.5,
    });
  });

  it("resolves model ids dynamically across every source", () => {
    const pricing: Record<string, PricingInfo> = {
      "anthropic/claude-opus-5": {
        cacheRead: 0.5,
        cacheWrite: 6.25,
        completion: 25,
        prompt: 5,
      },
      "anthropic/claude-sonnet-4-6": {
        cacheRead: 0.3,
        cacheWrite: 3.75,
        completion: 15,
        prompt: 3,
      },
      "gateway/claude-opus-5": { prompt: 50 },
      "gateway/gpt-6-codex": { prompt: 50 },
      "openai/gpt-6-codex": { prompt: 5 },
      "opencode/deepseek-v5-flash-free": { prompt: 1 },
      "openrouter/qwen/qwen4-coder:free": { prompt: 0 },
      "provider-a/shared-model": { prompt: 1 },
      "provider-b/shared-model": { prompt: 2 },
    };
    const usage = {
      cacheWrite: 4,
      cacheWrite1h: 0,
      cached: 3,
      input: 2,
      output: 1,
      reasoning: 0,
      total: 10,
    };

    expect(resolveModelId("claude-opus-5", pricing)).toBe("anthropic/claude-opus-5");
    expect(resolveModelId("claude-sonnet-4.6", pricing)).toBe("anthropic/claude-sonnet-4-6");
    expect(resolveModelId("gpt-6-codex", pricing)).toBe("openai/gpt-6-codex");
    expect(resolveModelId("deepseek-v5-flash-free", pricing)).toBe(
      "opencode/deepseek-v5-flash-free",
    );
    expect(resolveModelId("openrouter/qwen/qwen4-coder:free", pricing)).toBe(
      "openrouter/qwen/qwen4-coder:free",
    );
    expect(resolveModelId("qwen/qwen4-coder:free", pricing)).toBe(
      "openrouter/qwen/qwen4-coder:free",
    );
    expect(resolveModelId("shared-model", pricing)).toBe("shared-model");
    expect(resolveModelId("constructor", pricing)).toBe("constructor");
    expect(estimateCost("claude-opus-5", usage, pricing)).toBe(61.5);
    expect(estimateCost("claude-sonnet-4-6", usage, pricing)).toBe(36.9);
  });

  it("falls back cache-write rate to prompt when missing", () => {
    const cost = estimateCost(
      "openai/gpt-5",
      {
        cacheWrite: 4,
        cacheWrite1h: 0,
        cached: 0,
        input: 2,
        output: 3,
        reasoning: 0,
        total: 9,
      },
      {
        "openai/gpt-5": {
          completion: 3,
          prompt: 2,
        },
      },
    );

    expect(cost).toBe(21);
  });

  it("prices one-hour cache writes separately from default cache writes", () => {
    const cost = estimateCost(
      "claude-opus-5",
      {
        cacheWrite: 7,
        cacheWrite1h: 4,
        cached: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        total: 7,
      },
      {
        "anthropic/claude-opus-5": {
          cacheWrite: 2,
          cacheWrite1h: 3,
          prompt: 1,
        },
      },
    );

    expect(cost).toBe(18);
  });

  it("sums known model costs and ignores unknown pricing", () => {
    const stats = aggregateSessions([
      makeSession({
        modelTokens: {
          "gpt-5": {
            billableOutput: 2,
            cacheWrite: 0,
            cacheWrite1h: 0,
            cached: 0,
            input: 1,
            output: 2,
            reasoning: 0,
            total: 3,
          },
          unknown: {
            billableOutput: 99,
            cacheWrite: 0,
            cacheWrite1h: 0,
            cached: 0,
            input: 99,
            output: 99,
            reasoning: 0,
            total: 198,
          },
        },
        models: { "gpt-5": 1, unknown: 1 },
        requests: [],
      }),
    ]);

    const total = estimateStatsTotalCost(stats, {
      "openai/gpt-5": {
        completion: 3,
        prompt: 2,
      },
    });

    expect(total).toBe(8);
  });

  it("computes weighted input equivalent with alias and cache weights", () => {
    const request = makeRequest({
      cacheRead: 20,
      cacheWrite: 5,
      input: 100,
      model: "gpt-5.3-codex",
      total: 125,
      uncachedInput: 100,
    });
    const pricing = {
      "openai/gpt-5.3-codex": {
        cacheRead: 0.25,
        cacheWrite: 2,
        prompt: 1,
      },
    };

    expect(estimateWeightedInputEquivalent(request, pricing)).toBe(115);
    expect(summarizeRequestCache([request], pricing).weightedInputEqPerRequest).toBe(115);
  });

  it("formats usd semantics same as old script", () => {
    expect(formatUsd(undefined)).toBe("n/a");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0008)).toBe("$0.0008");
    expect(formatUsdPerMillion(undefined)).toBe("n/a");
    expect(formatUsdPerMillion(0)).toBe("$0/M");
    expect(formatUsdPerMillion(0.0000004)).toBe("$0.400/M");
  });
});
