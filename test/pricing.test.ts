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

  it("uses alias resolution and billable output for cost breakdown", () => {
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
        cached: 5,
        input: 10,
        output: 13,
        reasoning: 2,
        total: 37,
      },
      pricing,
    );

    expect(resolveModelId("gpt-5.4")).toBe("openai/gpt-5.4");
    expect(resolveModelId("gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
    expect(cost).toEqual({
      cacheWrite: 14,
      cached: 2.5,
      input: 10,
      output: 33,
      total: 59.5,
    });
  });

  it("falls back cache-write rate to prompt when missing", () => {
    const cost = estimateCost(
      "openai/gpt-5",
      {
        cacheWrite: 4,
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

  it("sums known model costs and ignores unknown pricing", () => {
    const stats = aggregateSessions([
      makeSession({
        modelTokens: {
          "gpt-5": {
            billableOutput: 2,
            cacheWrite: 0,
            cached: 0,
            input: 1,
            output: 2,
            reasoning: 0,
            total: 3,
          },
          unknown: {
            billableOutput: 99,
            cacheWrite: 0,
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
