import type { Scope } from "./report-core.js";
import { normalizeSectionList, validateSectionsForScope, type SectionKey } from "./sections.js";

export type ReportMode = "summary" | "full";

export const usageText = `Usage: agent-usage [--claude] [--scope today|1d|7d|30d] [--full | --section KEY[,KEY...]] [--html [FILE]]

Options:
  (default)       Include Codex, opencode, and Pi usage from local stores
  --claude        Include Claude Code usage from ~/.claude/projects
  --scope SCOPE   Use a range without prompting: today, 1d, 7d, 30d
  --full          Show full diagnostic report instead of default summary view
  --section KEYS  Show specific sections: comma-separated and repeatable
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
  sections?: SectionKey[];
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

  validateOptions(state.options);
  return state.options;
}

function parseArg(argv: string[], state: ArgParseState): void {
  const arg = argv[state.index];

  switch (arg) {
    case "--claude":
      state.options.includeClaude = true;
      return;
    case "--scope":
      state.options.scope = parseScopeValue(argv[state.index + 1], "Missing value for --scope");
      state.index += 1;
      return;
    case "--html":
      parseHtmlFlag(argv, state);
      return;
    case "--full":
      enableFullMode(state);
      return;
    case "--section":
      parseSectionValue(argv[state.index + 1], state, "Missing value for --section");
      state.index += 1;
      return;
    case "-h":
    case "--help":
      state.options.help = true;
      return;
    default:
      parseInlineArg(arg, state);
  }
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

function parseInlineArg(arg: string, state: ArgParseState): void {
  if (arg.startsWith("--scope=")) {
    state.options.scope = parseScopeValue(arg.slice("--scope=".length));
    return;
  }
  if (arg.startsWith("--section=")) {
    parseSectionValue(arg.slice("--section=".length), state);
    return;
  }
  if (arg.startsWith("--html=")) {
    state.options.html = true;
    state.options.htmlPath = arg.slice("--html=".length);
    return;
  }
  throw new UsageError(`Unknown argument: ${arg}`);
}

function enableFullMode(state: ArgParseState): void {
  if (state.options.sections) {
    throw new UsageError("Cannot use --full with --section");
  }
  state.options.reportMode = "full";
}

function parseHtmlFlag(argv: string[], state: ArgParseState): void {
  state.options.html = true;
  const value = argv[state.index + 1];
  if (value && !value.startsWith("--")) {
    state.options.htmlPath = value;
    state.index += 1;
  }
}

function validateOptions(options: CliOptions): void {
  if (options.scope && options.sections) {
    try {
      validateSectionsForScope(options.scope, options.sections);
    } catch (error) {
      if (error instanceof Error) {
        throw new UsageError(error.message);
      }
      throw error;
    }
  }
}

function parseSectionValue(
  value: string | undefined,
  state: ArgParseState,
  missingMessage?: string,
): void {
  if (!value) {
    throw new UsageError(missingMessage ?? `Invalid --section: ${value}`);
  }
  if (state.options.reportMode === "full") {
    throw new UsageError("Cannot use --section with --full");
  }

  try {
    const nextValues = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (nextValues.length === 0) {
      throw new UsageError(`Invalid --section: ${value}`);
    }
    const next = normalizeSectionList(nextValues);
    state.options.sections = normalizeSectionList([...(state.options.sections ?? []), ...next]);
  } catch (error) {
    if (error instanceof Error) {
      throw new UsageError(error.message);
    }
    throw error;
  }
}
