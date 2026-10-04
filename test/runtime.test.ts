import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { UsageError } from "../src/args.js";
import type { JsonReport } from "../src/json-report.js";
import { collectSessions, runCli, type RuntimeDeps } from "../src/runtime.js";
import { makeRequest, makeSession, useTempDirs } from "./fixtures.js";

const tempDirs = useTempDirs();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCli", () => {
  it("omits daily-usage from section prompt for today", async () => {
    let availableSections: string[] = [];

    const code = await runCli(
      {
        help: false,
        html: true,
        htmlPath: "-",
        reportMode: "summary",
        showOriginators: false,
        sources: ["codex"],
      },
      testDeps({
        chooseAction: async (_items, header) =>
          header === "Show originators in per-source sections?" ? "No" : "today",
        chooseSections: async (defaults, available) => {
          availableSections = available;
          return defaults;
        },
        chooseSources: async () => {
          throw new Error("should not prompt for sources");
        },
      }),
    );

    expect(code).toBe(0);
    expect(availableSections).not.toContain("daily-usage");
  });

  it("writes html to stdout when --html=-", async () => {
    const { code, stdout } = await runHtmlCli("-");

    expect(code).toBe(0);
    expect(stdout).toContain("<!doctype html>");
    expect(stdout).toContain("No sessions found in this range.");
  });

  it("prompts for sources in interactive html mode", async () => {
    let prompted = false;

    await runCli(
      {
        help: false,
        html: true,
        reportMode: "summary",
        showOriginators: false,
      },
      testDeps({
        chooseAction: async (_items, header) =>
          header === "Show originators in per-source sections?" ? "Yes" : "today",
        chooseSections: async (defaults) => defaults,
        chooseSources: async () => {
          prompted = true;
          return ["codex"];
        },
      }),
    );

    expect(prompted).toBe(true);
  });

  it("does not preselect sources in interactive mode", async () => {
    let defaults: string[] = [];

    const code = await runCli(
      {
        help: false,
        html: false,
        reportMode: "summary",
        showOriginators: false,
      },
      testDeps({
        chooseAction: async (_items, header) => {
          if (header === "Pick a time range") {
            return "today";
          }
          if (header === "Show originators in per-source sections?") {
            return "No";
          }
          return "Exit";
        },
        chooseSections: async (sectionDefaults) => sectionDefaults,
        chooseSources: async (sourceDefaults) => {
          defaults = sourceDefaults;
          return ["codex"];
        },
      }),
    );

    expect(code).toBe(0);
    expect(defaults).toEqual([]);
  });

  it("prompts for originators in interactive terminal mode", async () => {
    const prompts: string[] = [];

    await runCli(
      {
        help: false,
        html: false,
        reportMode: "summary",
        scope: "today",
        showOriginators: false,
        sources: ["codex"],
      },
      testDeps({
        chooseAction: async (_items, header) => {
          prompts.push(header);
          if (header === "Show originators in per-source sections?") {
            return "Yes";
          }
          return "Exit";
        },
        chooseSections: async (defaults) => defaults,
        chooseSources: async () => {
          throw new Error("should not prompt for sources");
        },
      }),
    );

    expect(prompts).toContain("Show originators in per-source sections?");
  });

  it("requires source flags in non-interactive flag mode", async () => {
    await expect(
      runCli(
        {
          help: false,
          html: true,
          htmlPath: "-",
          reportMode: "summary",
          scope: "today",
          showOriginators: false,
        },
        testDeps({
          chooseAction: async () => {
            throw new Error("should not prompt");
          },
          chooseSections: async (defaults) => defaults,
          chooseSources: async () => {
            throw new Error("should not prompt");
          },
          interactive: false,
        }),
      ),
    ).rejects.toThrowError(
      new UsageError("Missing source flag. Use --codex, --opencode, --pi, or --claude"),
    );
  });

  it("passes no-cache through to session collection", async () => {
    let useCache: boolean | undefined;

    const code = await runCli(
      {
        help: false,
        html: true,
        htmlPath: "-",
        noCache: true,
        reportMode: "summary",
        scope: "today",
        showOriginators: false,
        sources: ["codex"],
      },
      testDeps({
        chooseAction: async () => {
          throw new Error("should not prompt");
        },
        chooseSections: async (defaults) => defaults,
        chooseSources: async () => {
          throw new Error("should not prompt for sources");
        },
        clearScreen: () => {},
        collectSessions: async (_sources, _start, options) => {
          useCache = options?.useCache;
          return [];
        },
      }),
    );

    expect(code).toBe(0);
    expect(useCache).toBe(false);
  });

  it("leaves the parsed-session cache untouched without the cache", async () => {
    const home = await mkdtemp(join(tmpdir(), "agent-usage-home-"));
    tempDirs.push(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CACHE_HOME", join(home, "cache"));

    await collectSessions(["codex"], new Date(0), { useCache: false });

    expect(existsSync(join(home, "cache"))).toBe(false);
  });

  it("prints report data as json without prompting", async () => {
    let stdout = "";
    const session = makeSession({
      requests: [
        makeRequest({ input: 1_000_000, model: "gpt-5", total: 1_000_000 }),
        makeRequest({ input: 10, model: "brand-new-model", total: 10 }),
      ],
    });

    const code = await runCli(
      {
        help: false,
        html: false,
        json: true,
        reportMode: "summary",
        scope: "7d",
        showOriginators: false,
        sources: ["codex"],
      },
      testDeps({
        chooseAction: async () => {
          throw new Error("should not prompt");
        },
        chooseSections: async () => {
          throw new Error("should not prompt for sections");
        },
        collectSessions: async () => [session],
        loadPricing: async () => ({ "openai/gpt-5": { completion: 0, prompt: 0.000001 } }),
        now: () => new Date("2026-06-14T18:45:00Z"),
        stdout: { write: (chunk: string) => ((stdout += chunk), true) },
      }),
    );

    const report = JSON.parse(stdout) as JsonReport;
    expect(code).toBe(0);
    expect(report.totals).toMatchObject({ cost: 1, requests: 2, sessions: 1 });
    expect(report.models.map(({ model, pricingId }) => ({ model, pricingId }))).toEqual([
      { model: "brand-new-model", pricingId: null },
      { model: "gpt-5", pricingId: "openai/gpt-5" },
    ]);
    expect(report.unpricedModels).toEqual(["brand-new-model"]);
    expect(report.sources.map((source) => source.title)).toEqual(["Codex"]);
  });

  it("writes html file and exits in file mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-usage-runtime-"));
    tempDirs.push(dir);
    const outputPath = join(dir, "report.html");
    const { code, stdout } = await runHtmlCli(outputPath, async () => {
      throw new Error("should not open explicit output path");
    });

    expect(code).toBe(0);
    expect(stdout).toContain(outputPath);
    expect(await readFile(outputPath, "utf8")).toContain("Agent usage report");
  });

  it("wraps html report paths in OSC 8 hyperlinks for TTY output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-usage runtime-"));
    tempDirs.push(dir);
    const outputPath = join(dir, "report file.html");
    const { stdout } = await runHtmlCli(outputPath, async () => {}, true);

    expect(stdout).toContain(`HTML report: \u001B]8;;file://${outputPath.replaceAll(" ", "%20")}`);
    expect(stdout).toContain(`\u001B\\${outputPath}\u001B]8;;\u001B\\`);
  });
});

async function runHtmlCli(
  htmlPath: string,
  openPath: () => Promise<void> = async () => {},
  stdoutIsTTY = false,
): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const code = await runCli(
    {
      help: false,
      html: true,
      htmlPath,
      reportMode: "summary",
      scope: "today",
      showOriginators: false,
      sources: ["codex"],
    },
    {
      chooseAction: async () => {
        throw new Error("should not prompt during html runs");
      },
      chooseSections: async (defaults) => defaults,
      chooseSources: async () => {
        throw new Error("should not prompt for sources");
      },
      clearScreen: () => {},
      collectSessions: async () => [],
      loadPricing: async () => ({}),
      now: () => new Date("2026-06-14T18:45:00+05:30"),
      openPath,
      stderr: { write: () => true },
      stdout: { isTTY: stdoutIsTTY, write: (chunk: string) => ((stdout += chunk), true) },
    },
  );

  return { code, stdout };
}

function testDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return {
    chooseAction: async () => "today",
    chooseSections: async (defaults) => defaults,
    chooseSources: async () => ["codex"],
    clearScreen: () => {},
    collectSessions: async () => [],
    loadPricing: async () => ({}),
    now: () => new Date("2026-06-14T18:45:00+05:30"),
    openPath: async () => {},
    stderr: { write: () => true },
    stdout: { write: () => true },
    ...overrides,
  };
}
