import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { runCli } from "../src/runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    tempDirs
      .splice(0)
      .map(async (dir) =>
        import("node:fs/promises").then(({ rm }) => rm(dir, { force: true, recursive: true })),
      ),
  );
});

describe("runCli", () => {
  it("writes html to stdout when --html=-", async () => {
    let stdout = "";

    const code = await runCli(
      {
        help: false,
        html: true,
        htmlPath: "-",
        includeClaude: false,
        reportMode: "summary",
        scope: "today",
      },
      {
        chooseAction: async () => undefined,
        clearScreen: () => {},
        collectSessions: async () => [],
        loadPricing: async () => ({}),
        now: () => new Date("2026-06-14T18:45:00+05:30"),
        openPath: async () => {},
        stderr: { write: () => true },
        stdout: { write: (chunk: string) => ((stdout += chunk), true) },
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("<!doctype html>");
    expect(stdout).toContain("No sessions found in this range.");
  });

  it("writes html file and exits in file mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-usage-runtime-"));
    tempDirs.push(dir);
    const outputPath = join(dir, "report.html");
    let stdout = "";

    const code = await runCli(
      {
        help: false,
        html: true,
        htmlPath: outputPath,
        includeClaude: false,
        reportMode: "summary",
        scope: "today",
      },
      {
        chooseAction: async () => undefined,
        clearScreen: () => {},
        collectSessions: async () => [],
        loadPricing: async () => ({}),
        now: () => new Date("2026-06-14T18:45:00+05:30"),
        openPath: async () => {
          throw new Error("should not open explicit output path");
        },
        stderr: { write: () => true },
        stdout: { write: (chunk: string) => ((stdout += chunk), true) },
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain(outputPath);
    expect(await readFile(outputPath, "utf8")).toContain("Agent usage report");
  });
});
