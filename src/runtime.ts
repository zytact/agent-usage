import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import select from "@inquirer/select";

import type { CliOptions } from "./args.js";
import { defaultDiscoveryRoots, discoverSessionFiles } from "./discovery.js";
import type { ParsedSession } from "./domain.js";
import { renderHtmlReport, writeHtmlReport } from "./html-report.js";
import { parseClaudeSessionFile } from "./parsers/claude.js";
import { parseCodexSessionFile } from "./parsers/codex.js";
import { parseOpencodeDb } from "./parsers/opencode.js";
import { parsePiSessionFile } from "./parsers/pi.js";
import { loadPricingMap } from "./pricing.js";
import { type Scope } from "./report-core.js";
import { buildReport, type PricingInfo } from "./report-data.js";
import { renderTerminalReport } from "./terminal-report.js";

export type RuntimeDeps = {
  chooseAction: (items: string[], header: string) => Promise<string | undefined>;
  clearScreen: () => void;
  collectSessions: (includeClaude: boolean) => Promise<ParsedSession[]>;
  loadPricing: () => Promise<Record<string, PricingInfo>>;
  now: () => Date;
  openPath: (path: string) => Promise<void>;
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export function defaultRuntimeDeps(): RuntimeDeps {
  return {
    chooseAction: promptChoose,
    clearScreen: () => {
      process.stdout.write("\x1bc");
    },
    collectSessions,
    loadPricing: () => loadPricingMap(),
    now: () => new Date(),
    openPath,
    stderr: process.stderr,
    stdout: process.stdout,
  };
}

export async function runCli(
  options: CliOptions,
  deps: RuntimeDeps = defaultRuntimeDeps(),
): Promise<number> {
  const scope =
    options.scope ?? (await deps.chooseAction(["today", "7d", "30d"], "Pick a time range"));
  if (!scope) {
    return 0;
  }

  const sessions = await deps.collectSessions(options.includeClaude);
  const pricing = await deps.loadPricing();

  if (options.html) {
    const outputPath = await resolveHtmlPath(options.htmlPath);
    const html = renderHtmlReport(
      buildReport(sessions, scope as Scope, options.includeClaude, deps.now()),
      pricing,
    );

    if (outputPath === "-") {
      deps.stdout.write(`${html}\n`);
      return 0;
    }

    await writeHtmlReport(outputPath, html);
    deps.stdout.write(`HTML report: ${outputPath}\n`);
    if (!options.htmlPath) {
      await deps.openPath(outputPath);
    }
    return 0;
  }

  let currentScope = scope as Scope;
  while (true) {
    deps.clearScreen();
    const report = buildReport(sessions, currentScope, options.includeClaude, deps.now());
    deps.stdout.write(`${renderTerminalReport(report, pricing)}\n`);

    const action = await deps.chooseAction(
      ["Open HTML report", "Change range", "Refresh", "Exit"],
      "Choose an action",
    );
    if (!action || action === "Exit") {
      return 0;
    }
    if (action === "Refresh") {
      continue;
    }
    if (action === "Change range") {
      const nextScope = await deps.chooseAction(["today", "7d", "30d"], "Pick a time range");
      if (!nextScope) {
        return 0;
      }
      currentScope = nextScope as Scope;
      continue;
    }
    if (action === "Open HTML report") {
      const outputPath = await resolveHtmlPath();
      const html = renderHtmlReport(report, pricing);
      await writeHtmlReport(outputPath, html);
      deps.stdout.write(`HTML report: ${outputPath}\n`);
      await deps.openPath(outputPath);
    }
  }
}

export async function collectSessions(includeClaude: boolean): Promise<ParsedSession[]> {
  const roots = defaultDiscoveryRoots(homedir());
  const discovered = await discoverSessionFiles(roots);
  const codexSessions = (
    await Promise.all(discovered.codexFiles.map((path) => parseCodexSessionFile(path)))
  ).filter((value): value is ParsedSession => value !== undefined);
  const piSessions = (
    await Promise.all(discovered.piFiles.map((path) => parsePiSessionFile(path)))
  ).filter((value): value is ParsedSession => value !== undefined);
  const claudeSessions = includeClaude
    ? (
        await Promise.all(discovered.claudeFiles.map((path) => parseClaudeSessionFile(path)))
      ).filter((value): value is ParsedSession => value !== undefined)
    : [];
  const opencodeSessions = await parseOpencodeDb(discovered.opencodeDbPath);

  return [...codexSessions, ...opencodeSessions, ...claudeSessions, ...piSessions];
}

async function resolveHtmlPath(path?: string): Promise<string> {
  if (path) {
    return path === "-" ? "-" : resolve(path);
  }
  const dir = await mkdtemp(join(tmpdir(), "agent-usage-report-"));
  return join(dir, "report.html");
}

async function promptChoose(items: string[], header: string): Promise<string | undefined> {
  try {
    return await select({
      choices: items.map((item) => ({ name: item, value: item })),
      message: header,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      return undefined;
    }
    throw error;
  }
}

async function openPath(path: string): Promise<void> {
  void path;
}
