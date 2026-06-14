import type { Scope } from "./report-core.js";

export type ReportMode = "summary" | "full";

export const usageText = `Usage: agent-usage [--claude] [--scope today|1d|7d|30d] [--full] [--html [FILE]]

Options:
  (default)       Include Codex, opencode, and Pi usage from local stores
  --claude        Include Claude Code usage from ~/.claude/projects
  --scope SCOPE   Use a range without prompting: today, 1d, 7d, 30d
  --full          Show full diagnostic report instead of default summary view
  --html [FILE]   Write a standalone HTML report. Omit FILE to decide later.
                  Use --html=- to print HTML to stdout.
  -h, --help      Show this help
`;

export type CliOptions = {
  includeClaude: boolean;
  scope?: Scope;
  html: boolean;
  htmlPath?: string;
  help: boolean;
  reportMode: ReportMode;
};

export class UsageError extends Error {}

const validScopes = new Set<Scope>(["today", "1d", "7d", "30d"]);

type ArgParseState = {
  index: number;
  options: CliOptions;
};

export function parseArgs(argv: string[]): CliOptions {
  const state: ArgParseState = {
    index: 0,
    options: { includeClaude: false, html: false, help: false, reportMode: "summary" },
  };

  while (state.index < argv.length) {
    parseArg(argv, state);
    state.index += 1;
  }

  return state.options;
}

function parseArg(argv: string[], state: ArgParseState): void {
  const arg = argv[state.index];

  if (arg === "--claude") {
    state.options.includeClaude = true;
    return;
  }
  if (arg === "--scope") {
    state.options.scope = parseScopeValue(argv[state.index + 1], "Missing value for --scope");
    state.index += 1;
    return;
  }
  if (arg.startsWith("--scope=")) {
    state.options.scope = parseScopeValue(arg.slice("--scope=".length));
    return;
  }
  if (arg === "--html") {
    parseHtmlFlag(argv, state);
    return;
  }
  if (arg === "--full") {
    state.options.reportMode = "full";
    return;
  }
  if (arg.startsWith("--html=")) {
    state.options.html = true;
    state.options.htmlPath = arg.slice("--html=".length);
    return;
  }
  if (arg === "-h" || arg === "--help") {
    state.options.help = true;
    return;
  }

  throw new UsageError(`Unknown argument: ${arg}`);
}

function parseScopeValue(value: string | undefined, missingMessage?: string): Scope {
  if (!value) {
    throw new UsageError(missingMessage ?? `Invalid --scope: ${value}`);
  }
  if (!validScopes.has(value as Scope)) {
    throw new UsageError(`Invalid --scope: ${value}`);
  }
  return value as Scope;
}

function parseHtmlFlag(argv: string[], state: ArgParseState): void {
  state.options.html = true;
  const value = argv[state.index + 1];
  if (value && !value.startsWith("--")) {
    state.options.htmlPath = value;
    state.index += 1;
  }
}
