import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { runCli } from "../src/runtime.js";
import { useTempDirs } from "./fixtures.js";

const tempDirs = useTempDirs();

describe("runCli", () => {
  it("writes html to stdout when --html=-", async () => {
    const { code, stdout } = await runHtmlCli("-");

    expect(code).toBe(0);
    expect(stdout).toContain("<!doctype html>");
    expect(stdout).toContain("No sessions found in this range.");
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
});

async function runHtmlCli(
  htmlPath: string,
  openPath: () => Promise<void> = async () => {},
): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const code = await runCli(
    {
      help: false,
      html: true,
      htmlPath,
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
      openPath,
      stderr: { write: () => true },
      stdout: { write: (chunk: string) => ((stdout += chunk), true) },
    },
  );

  return { code, stdout };
}
