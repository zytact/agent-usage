import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import checkbox from "@inquirer/checkbox";
import select from "@inquirer/select";

import { DEFAULT_SOURCES, UsageError, type CliOptions } from "./args.js";
import { defaultDiscoveryRoots, discoverSessionFiles } from "./discovery.js";
import type { ParsedSession, SourceId } from "./domain.js";
import { renderHtmlReport, writeHtmlReport } from "./html-report.js";
import { parseClaudeSessionFile } from "./parsers/claude.js";
import { parseCodexSessionFile } from "./parsers/codex.js";
import { parseOpencodeDb } from "./parsers/opencode.js";
import { parsePiSessionFile } from "./parsers/pi.js";
import { loadPricingMap } from "./pricing.js";
import { scopeStart, type Scope } from "./report-core.js";
import { buildReport, type PricingInfo } from "./report-data.js";
import {
  SECTION_LABELS,
  availableSectionsForScope,
  defaultSectionsForScope,
  inferSectionModeForScope,
  sanitizeSectionsForScope,
  type SectionKey,
} from "./sections.js";
import { renderTerminalReport } from "./terminal-report.js";

const SOURCE_LABELS: Record<SourceId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  pi: "Pi",
};

const AVAILABLE_SOURCES: SourceId[] = ["codex", "opencode", "pi", "claude"];
const MISSING_SOURCE_FLAG_MESSAGE =
  "Missing source flag. Use --codex, --opencode, --pi, or --claude";

export type RuntimeDeps = {
  chooseAction: (items: string[], header: string) => Promise<string | undefined>;
  chooseSections: (
    defaults: SectionKey[],
    available: SectionKey[],
  ) => Promise<SectionKey[] | undefined>;
  chooseSources: (defaults: SourceId[], available: SourceId[]) => Promise<SourceId[] | undefined>;
  clearScreen: () => void;
  collectSessions: (
    sources: SourceId[],
    start: Date,
    options?: CollectSessionsOptions,
  ) => Promise<ParsedSession[]>;
  interactive?: boolean;
  loadPricing: () => Promise<Record<string, PricingInfo>>;
  now: () => Date;
  openPath: (path: string) => Promise<void>;
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
};

function defaultRuntimeDeps(): RuntimeDeps {
  return {
    chooseAction: promptChoose,
    chooseSections: promptSections,
    chooseSources: promptSources,
    clearScreen: () => {
      process.stdout.write("\x1bc");
    },
    collectSessions,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
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
  if (!options.sources && deps.interactive === false) {
    throw new UsageError(MISSING_SOURCE_FLAG_MESSAGE);
  }

  const scope = await chooseInitialScope(options, deps);
  if (!scope) {
    return 0;
  }

  const sources = await chooseSources(options, deps);
  if (!sources?.length) {
    return 0;
  }

  const showOriginators = shouldPromptForOriginators(options)
    ? await chooseOriginators(options, deps)
    : options.showOriginators;
  if (showOriginators === undefined) {
    return 0;
  }

  const sections = await chooseReportSections(options, deps, scope);
  if (!sections) {
    return 0;
  }

  const ingestScope = options.html ? scope : "30d";
  const sessions = await deps.collectSessions(sources, scopeStart(ingestScope, deps.now()), {
    useCache: !options.noCache,
  });
  const pricing = await deps.loadPricing();

  return options.html
    ? renderHtmlOnce(options, deps, sessions, pricing, scope, sections, sources, showOriginators)
    : runInteractiveReport(
        options,
        deps,
        sessions,
        pricing,
        scope,
        sections,
        sources,
        showOriginators,
      );
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

async function chooseSources(
  options: CliOptions,
  deps: RuntimeDeps,
): Promise<SourceId[] | undefined> {
  if (options.sources) {
    return options.sources;
  }
  if (deps.interactive === false) {
    throw new UsageError(MISSING_SOURCE_FLAG_MESSAGE);
  }
  return deps.chooseSources(DEFAULT_SOURCES, AVAILABLE_SOURCES);
}

function shouldPromptForOriginators(options: CliOptions): boolean {
  return !options.html || options.htmlPath === undefined;
}

async function chooseOriginators(
  options: CliOptions,
  deps: RuntimeDeps,
): Promise<boolean | undefined> {
  if (options.showOriginators) {
    return true;
  }
  const choice = await deps.chooseAction(["No", "Yes"], "Show originators in per-source sections?");
  return choice ? choice === "Yes" : undefined;
}

async function chooseReportSections(
  options: CliOptions,
  deps: RuntimeDeps,
  scope: Scope,
): Promise<SectionKey[] | undefined> {
  if (options.sections?.length) {
    return sanitizeSectionsForScope(scope, options.sections);
  }
  if (options.reportMode === "full") {
    return availableSectionsForScope(scope);
  }
  return deps.chooseSections(defaultSectionsForScope(scope), availableSectionsForScope(scope));
}

async function renderHtmlOnce(
  options: CliOptions,
  deps: RuntimeDeps,
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  scope: Scope,
  sections: SectionKey[],
  sources: SourceId[],
  showOriginators: boolean,
): Promise<number> {
  const outputPath = await resolveHtmlPath(options.htmlPath);
  const html = renderHtmlReport(
    buildReport(sessions, scope, sources, deps.now(), pricing, showOriginators),
    pricing,
    inferSectionModeForScope(scope, sections) === "full" ? "full" : "summary",
    sections,
  );

  if (outputPath === "-") {
    deps.stdout.write(`${html}\n`);
    return 0;
  }

  await writeHtmlReport(outputPath, html);
  deps.stdout.write(`HTML report: ${formatHtmlReportLink(outputPath, deps.stdout)}\n`);
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
  sections: SectionKey[],
  sources: SourceId[],
  initialShowOriginators: boolean,
): Promise<number> {
  let currentScope = scope;
  let showOriginators = initialShowOriginators;
  while (true) {
    const activeSections = sanitizeSectionsForScope(currentScope, sections);
    const report = writeTerminalReport(
      options,
      deps,
      sessions,
      pricing,
      currentScope,
      activeSections,
      sources,
      showOriginators,
    );
    const action = await deps.chooseAction(
      [
        "Open HTML report",
        showOriginators ? "Hide originators" : "Show originators",
        "Change range",
        "Refresh",
        "Exit",
      ],
      "Choose an action",
    );
    const next = await handleInteractiveAction(
      action,
      deps,
      report,
      pricing,
      options.reportMode,
      activeSections,
      showOriginators,
    );
    if (next.exit) {
      return 0;
    }
    currentScope = next.scope ?? currentScope;
    showOriginators = next.showOriginators ?? showOriginators;
  }
}

function writeTerminalReport(
  options: CliOptions,
  deps: RuntimeDeps,
  sessions: ParsedSession[],
  pricing: Record<string, PricingInfo>,
  scope: Scope,
  sections: SectionKey[],
  sources: SourceId[],
  showOriginators: boolean,
) {
  deps.clearScreen();
  const report = buildReport(sessions, scope, sources, deps.now(), pricing, showOriginators);
  deps.stdout.write(
    `${renderTerminalReport(
      report,
      pricing,
      inferSectionModeForScope(scope, sections) === "full" ? "full" : "summary",
      sections,
    )}\n`,
  );
  return report;
}

async function handleInteractiveAction(
  action: string | undefined,
  deps: RuntimeDeps,
  report: ReturnType<typeof buildReport>,
  pricing: Record<string, PricingInfo>,
  reportMode: CliOptions["reportMode"],
  sections: SectionKey[],
  showOriginators: boolean,
): Promise<{ exit?: boolean; scope?: Scope; showOriginators?: boolean }> {
  if (!action || action === "Exit") {
    return { exit: true };
  }
  if (action === "Refresh") {
    return {};
  }
  if (action === "Change range") {
    const scope = await changeScope(deps);
    return scope === "exit" ? { exit: true } : { scope };
  }
  if (action === "Show originators") {
    return { showOriginators: true };
  }
  if (action === "Hide originators") {
    return { showOriginators: false };
  }
  if (action === "Open HTML report") {
    await openHtmlReport(deps, report, pricing, reportMode, sections);
  }
  return { showOriginators };
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
  sections: SectionKey[],
): Promise<void> {
  const outputPath = await resolveHtmlPath();
  await writeHtmlReport(outputPath, renderHtmlReport(report, pricing, reportMode, sections));
  deps.stdout.write(`HTML report: ${formatHtmlReportLink(outputPath, deps.stdout)}\n`);
  await deps.openPath(outputPath);
}

function formatHtmlReportLink(
  outputPath: string,
  stdout: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean },
): string {
  if (!stdout.isTTY) {
    return outputPath;
  }
  const url = pathToFileURL(outputPath).href;
  return `\u001B]8;;${url}\u001B\\${outputPath}\u001B]8;;\u001B\\`;
}

type CollectSessionsOptions = {
  useCache?: boolean;
};

async function collectSessions(
  sources: SourceId[],
  start: Date,
  options: CollectSessionsOptions = {},
): Promise<ParsedSession[]> {
  const roots = defaultDiscoveryRoots(homedir());
  const discovered = await discoverSessionFiles(roots, start);
  const cacheDir = await ensureParsedSessionCacheDir();
  const selected = new Set(sources);
  const useCache = options.useCache ?? true;
  const [codexSessions, piSessions, claudeSessions, opencodeSessions] = await Promise.all([
    selected.has("codex")
      ? parseDiscoveredFiles(discovered.codexFiles, parseCodexSessionFile, cacheDir, useCache)
      : [],
    selected.has("pi")
      ? parseDiscoveredFiles(discovered.piFiles, parsePiSessionFile, cacheDir, useCache)
      : [],
    selected.has("claude")
      ? parseDiscoveredFiles(discovered.claudeFiles, parseClaudeSessionFile, cacheDir, useCache)
      : [],
    selected.has("opencode") ? parseOpencodeDb(discovered.opencodeDbPath, start) : [],
  ]);

  return [...codexSessions, ...opencodeSessions, ...claudeSessions, ...piSessions];
}

const PARSE_CONCURRENCY = 8;

const SESSION_CACHE_VERSION = 2;

type SessionCacheRecord = {
  mtimeMs: number;
  parsed: ParsedSession | null;
  size: number;
  version: number;
};

async function parseDiscoveredFiles(
  files: Awaited<ReturnType<typeof discoverSessionFiles>>["codexFiles"],
  parser: (path: string) => Promise<ParsedSession | undefined>,
  cacheDir: string,
  useCache: boolean,
): Promise<ParsedSession[]> {
  const parsed = await mapWithConcurrency(files, PARSE_CONCURRENCY, async (file) =>
    loadOrParseSession(file.path, file.size, file.mtimeMs, cacheDir, parser, useCache),
  );
  return parsed.filter((value): value is ParsedSession => value !== undefined);
}

async function loadOrParseSession(
  path: string,
  size: number,
  mtimeMs: number,
  cacheDir: string,
  parser: (path: string) => Promise<ParsedSession | undefined>,
  useCache: boolean,
): Promise<ParsedSession | undefined> {
  const cachePath = join(cacheDir, `${hashPath(path)}.json`);
  if (useCache) {
    const cached = await readCachedSession(cachePath, size, mtimeMs);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
  }

  const parsed = await parser(path);
  await writeSessionCache(cachePath, {
    mtimeMs,
    parsed: parsed ?? null,
    size,
    version: SESSION_CACHE_VERSION,
  });
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
    if (raw.version !== SESSION_CACHE_VERSION || raw.size !== size || raw.mtimeMs !== mtimeMs) {
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
    cacheWriteKnown: session.cacheWriteKnown ?? session.source !== "codex",
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

async function promptSources(
  defaults: SourceId[],
  available: SourceId[],
): Promise<SourceId[] | undefined> {
  const detail = available.filter((source) => !defaults.includes(source));
  try {
    return await checkbox({
      choices: [
        ...defaults.map((source) => ({
          checked: true,
          name: SOURCE_LABELS[source],
          value: source,
        })),
        ...detail.map((source) => ({
          checked: false,
          name: SOURCE_LABELS[source],
          value: source,
        })),
      ],
      instructions: false,
      loop: false,
      message: "Pick sources",
      pageSize: available.length + 2,
      required: true,
      shortcuts: { all: null, invert: null },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      return undefined;
    }
    throw error;
  }
}

async function promptSections(
  defaults: SectionKey[],
  available: SectionKey[],
): Promise<SectionKey[] | undefined> {
  const detail = available.filter((section) => !defaults.includes(section));
  try {
    const selected = await checkbox({
      choices: [
        ...defaults.map((section) => ({
          checked: true,
          description:
            section === "source-sections" ? "Codex, opencode, Pi, Claude Code" : undefined,
          name: SECTION_LABELS[section],
          value: section,
        })),
        ...detail.map((section) => ({
          checked: false,
          description:
            section === "source-section-languages" ? "Only affects per-source sections" : undefined,
          name: SECTION_LABELS[section],
          value: section,
        })),
      ],
      instructions: false,
      loop: false,
      message: "Pick report sections",
      pageSize: available.length + 2,
      required: true,
      shortcuts: { all: null, invert: null },
    });
    return selected;
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
