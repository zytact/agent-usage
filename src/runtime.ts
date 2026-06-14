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

function defaultRuntimeDeps(): RuntimeDeps {
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
  const scope = await chooseInitialScope(options, deps);
  if (!scope) {
    return 0;
  }

  const sessions = await deps.collectSessions(options.includeClaude);
  const pricing = await deps.loadPricing();

  return options.html
    ? renderHtmlOnce(options, deps, sessions, pricing, scope)
    : runInteractiveReport(options, deps, sessions, pricing, scope);
}

async function chooseInitialScope(
  options: CliOptions,
  deps: RuntimeDeps,
): Promise<Scope | undefined> {
  return (options.scope ??
    (await deps.chooseAction(["today", "7d", "30d"], "Pick a time range"))) as Scope | undefined;
}

async function renderHtmlOnce(
  options: CliOptions,
  deps: RuntimeDeps,
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  scope: Scope,
): Promise<number> {
  const outputPath = await resolveHtmlPath(options.htmlPath);
  const html = renderHtmlReport(
    buildReport(sessions, scope, options.includeClaude, deps.now()),
    pricing,
    options.reportMode,
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

async function runInteractiveReport(
  options: CliOptions,
  deps: RuntimeDeps,
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  scope: Scope,
): Promise<number> {
  let currentScope = scope;
  while (true) {
    const report = writeTerminalReport(options, deps, sessions, pricing, currentScope);
    const action = await deps.chooseAction(
      ["Open HTML report", "Change range", "Refresh", "Exit"],
      "Choose an action",
    );
    const nextScope = await handleInteractiveAction(
      action,
      deps,
      report,
      pricing,
      options.reportMode,
    );
    if (nextScope === "exit") {
      return 0;
    }
    currentScope = nextScope ?? currentScope;
  }
}

function writeTerminalReport(
  options: CliOptions,
  deps: RuntimeDeps,
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  scope: Scope,
) {
  deps.clearScreen();
  const report = buildReport(sessions, scope, options.includeClaude, deps.now());
  deps.stdout.write(`${renderTerminalReport(report, pricing, options.reportMode)}\n`);
  return report;
}

async function handleInteractiveAction(
  action: string | undefined,
  deps: RuntimeDeps,
  report: ReturnType<typeof buildReport>,
  pricing: Record<string, PricingInfo>,
  reportMode: CliOptions["reportMode"],
): Promise<Scope | "exit" | undefined> {
  if (!action || action === "Exit") {
    return "exit";
  }
  if (action === "Refresh") {
    return undefined;
  }
  if (action === "Change range") {
    return changeScope(deps);
  }
  if (action === "Open HTML report") {
    await openHtmlReport(deps, report, pricing, reportMode);
  }
  return undefined;
}

async function changeScope(deps: RuntimeDeps): Promise<Scope | "exit"> {
  const nextScope = await deps.chooseAction(["today", "7d", "30d"], "Pick a time range");
  return nextScope ? (nextScope as Scope) : "exit";
}

async function openHtmlReport(
  deps: RuntimeDeps,
  report: ReturnType<typeof buildReport>,
  pricing: Record<string, PricingInfo>,
  reportMode: CliOptions["reportMode"],
): Promise<void> {
  const outputPath = await resolveHtmlPath();
  await writeHtmlReport(outputPath, renderHtmlReport(report, pricing, reportMode));
  deps.stdout.write(`HTML report: ${outputPath}\n`);
  await deps.openPath(outputPath);
}

async function collectSessions(includeClaude: boolean): Promise<ParsedSession[]> {
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
