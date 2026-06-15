import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
import { scopeStart, type Scope } from "./report-core.js";
import { buildReport, type PricingInfo } from "./report-data.js";
import { renderTerminalReport } from "./terminal-report.js";

export type RuntimeDeps = {
  chooseAction: (items: string[], header: string) => Promise<string | undefined>;
  clearScreen: () => void;
  collectSessions: (includeClaude: boolean, start: Date) => Promise<ParsedSession[]>;
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

  const ingestScope = options.html ? scope : "30d";
  const sessions = await deps.collectSessions(
    options.includeClaude,
    scopeStart(ingestScope, deps.now()),
  );
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
    (await deps.chooseAction(["today", "1d", "7d", "30d"], "Pick a time range"))) as
    | Scope
    | undefined;
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
    buildReport(sessions, scope, options.includeClaude, deps.now(), pricing),
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
  const report = buildReport(sessions, scope, options.includeClaude, deps.now(), pricing);
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
  const nextScope = await deps.chooseAction(["today", "1d", "7d", "30d"], "Pick a time range");
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

async function collectSessions(includeClaude: boolean, start: Date): Promise<ParsedSession[]> {
  const roots = defaultDiscoveryRoots(homedir());
  const discovered = await discoverSessionFiles(roots, start);
  const cacheDir = await ensureParsedSessionCacheDir();
  const codexSessions = await parseDiscoveredFiles(
    discovered.codexFiles,
    parseCodexSessionFile,
    cacheDir,
  );
  const piSessions = await parseDiscoveredFiles(discovered.piFiles, parsePiSessionFile, cacheDir);
  const claudeSessions = includeClaude
    ? await parseDiscoveredFiles(discovered.claudeFiles, parseClaudeSessionFile, cacheDir)
    : [];
  const opencodeSessions = await parseOpencodeDb(discovered.opencodeDbPath, start);

  return [...codexSessions, ...opencodeSessions, ...claudeSessions, ...piSessions];
}

const PARSE_CONCURRENCY = 8;

type SessionCacheRecord = {
  mtimeMs: number;
  parsed: ParsedSession | null;
  size: number;
};

async function parseDiscoveredFiles(
  files: Awaited<ReturnType<typeof discoverSessionFiles>>["codexFiles"],
  parser: (path: string) => Promise<ParsedSession | undefined>,
  cacheDir: string,
): Promise<ParsedSession[]> {
  const parsed = await mapWithConcurrency(files, PARSE_CONCURRENCY, async (file) =>
    loadOrParseSession(file.path, file.size, file.mtimeMs, cacheDir, parser),
  );
  return parsed.filter((value): value is ParsedSession => value !== undefined);
}

async function loadOrParseSession(
  path: string,
  size: number,
  mtimeMs: number,
  cacheDir: string,
  parser: (path: string) => Promise<ParsedSession | undefined>,
): Promise<ParsedSession | undefined> {
  const cachePath = join(cacheDir, `${hashPath(path)}.json`);
  const cached = await readCachedSession(cachePath, size, mtimeMs);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  const parsed = await parser(path);
  await writeSessionCache(cachePath, { mtimeMs, parsed: parsed ?? null, size });
  return parsed;
}

async function ensureParsedSessionCacheDir(): Promise<string> {
  const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  const cacheDir = join(cacheRoot, "agent-usage", "parsed-sessions");
  await mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

async function readCachedSession(
  cachePath: string,
  size: number,
  mtimeMs: number,
): Promise<ParsedSession | null | undefined> {
  try {
    const raw = JSON.parse(await readFile(cachePath, "utf8")) as SessionCacheRecord;
    if (raw.size !== size || raw.mtimeMs !== mtimeMs) {
      return undefined;
    }
    return reviveParsedSession(raw.parsed);
  } catch {
    return undefined;
  }
}

async function writeSessionCache(cachePath: string, record: SessionCacheRecord): Promise<void> {
  await writeFile(cachePath, JSON.stringify(record));
}

function reviveParsedSession(session: ParsedSession | null): ParsedSession | null {
  if (!session) {
    return null;
  }

  return {
    ...session,
    end: new Date(session.end),
    requests: session.requests.map((request) => ({ ...request, ts: new Date(request.ts) })),
    start: new Date(session.start),
  };
}

function hashPath(path: string): string {
  return createHash("sha1").update(path).digest("hex");
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  limit: number,
  map: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const out = Array.from({ length: values.length }) as TOutput[];
  let index = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (index < values.length) {
        const current = index;
        index += 1;
        out[current] = await map(values[current]);
      }
    }),
  );

  return out;
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
