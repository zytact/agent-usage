import type { SourceId } from "./domain.js";
import type { Scope } from "./report-core.js";
import { normalizeSectionList, validateSectionsForScope, type SectionKey } from "./sections.js";

export type ReportMode = "summary" | "full";

export const DEFAULT_SOURCES: SourceId[] = ["codex", "opencode", "pi"];
const SOURCE_FLAGS: Record<string, SourceId> = {
  "--claude": "claude",
  "--codex": "codex",
  "--opencode": "opencode",
  "--pi": "pi",
};

export const usageText = `Usage: agent-usage [--codex] [--opencode] [--pi] [--claude] [--scope today|1d|7d|30d] [--full | --section KEY[,KEY...]] [--html [FILE]]

Options:
  (default)       Preselect Codex, opencode, and Pi usage from local stores
  --codex         Include Codex usage from ~/.codex/sessions
  --opencode      Include opencode usage from ~/.local/share/opencode/opencode.db
  --pi            Include Pi usage from ~/.pi/agent/sessions
  --claude        Include Claude Code usage from ~/.claude/projects
  --scope SCOPE   Use a range without prompting: today, 1d, 7d, 30d
  --full          Show full diagnostic report instead of default summary view
  --section KEYS  Show specific sections: comma-separated and repeatable
  --html [FILE]   Write a standalone HTML report. Omit FILE to decide later.
                  Use --html=- to print HTML to stdout.
  -h, --help      Show this help
`;

export type CliOptions = {
  scope?: Scope;
  html: boolean;
  htmlPath?: string;
  help: boolean;
  reportMode: ReportMode;
  sections?: SectionKey[];
  sources?: SourceId[];
};

export class UsageError extends Error {}

const validScopes = new Set<Scope>(["today", "1d", "7d", "30d"]);

type ArgParseState = {
  index: number;
  options: CliOptions;
};

type ArgHandler = (argv: string[], state: ArgParseState) => void;

export function parseArgs(argv: string[]): CliOptions {
  const state: ArgParseState = {
    index: 0,
    options: { html: false, help: false, reportMode: "summary" },
  };

  while (state.index < argv.length) {
    parseArg(argv, state);
    state.index += 1;
  }

  validateOptions(state.options);
  return state.options;
}

const ARG_HANDLERS: Record<string, ArgHandler> = {
  "--claude": (_argv, state) => addSourceFlag(state, SOURCE_FLAGS["--claude"]),
  "--codex": (_argv, state) => addSourceFlag(state, SOURCE_FLAGS["--codex"]),
  "--full": (_argv, state) => enableFullMode(state),
  "--help": (_argv, state) => {
    state.options.help = true;
  },
  "--html": parseHtmlFlag,
  "--opencode": (_argv, state) => addSourceFlag(state, SOURCE_FLAGS["--opencode"]),
  "--pi": (_argv, state) => addSourceFlag(state, SOURCE_FLAGS["--pi"]),
  "--scope": (argv, state) => {
    state.options.scope = parseScopeValue(argv[state.index + 1], "Missing value for --scope");
    state.index += 1;
  },
  "--section": (argv, state) => {
    parseSectionValue(argv[state.index + 1], state, "Missing value for --section");
    state.index += 1;
  },
  "-h": (_argv, state) => {
    state.options.help = true;
  },
};

function parseArg(argv: string[], state: ArgParseState): void {
  const arg = argv[state.index];
  const handler = ARG_HANDLERS[arg];
  if (handler) {
    handler(argv, state);
    return;
  }
  parseInlineArg(arg, state);
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

function addSourceFlag(state: ArgParseState, source: SourceId): void {
  state.options.sources = normalizeSourceList([...(state.options.sources ?? []), source]);
}

function normalizeSourceList(sources: SourceId[]): SourceId[] {
  return [...new Set(sources)];
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
