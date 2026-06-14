import type { Scope } from "./report-core.js";

export const usageText = `Usage: agent-usage [--claude] [--scope today|7d|30d] [--html [FILE]]

Options:
  (default)       Include Codex, opencode, and Pi usage from local stores
  --claude        Include Claude Code usage from ~/.claude/projects
  --scope SCOPE   Use a range without prompting: today, 7d, 30d
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
};

export class UsageError extends Error {}

const validScopes = new Set<Scope>(["today", "7d", "30d"]);

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    includeClaude: false,
    html: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--claude") {
      options.includeClaude = true;
      continue;
    }

    if (arg === "--scope") {
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError("Missing value for --scope");
      }
      if (!validScopes.has(value as Scope)) {
        throw new UsageError(`Invalid --scope: ${value}`);
      }
      options.scope = value as Scope;
      index += 1;
      continue;
    }

    if (arg.startsWith("--scope=")) {
      const value = arg.slice("--scope=".length);
      if (!validScopes.has(value as Scope)) {
        throw new UsageError(`Invalid --scope: ${value}`);
      }
      options.scope = value as Scope;
      continue;
    }

    if (arg === "--html") {
      options.html = true;
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) {
        options.htmlPath = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--html=")) {
      options.html = true;
      options.htmlPath = arg.slice("--html=".length);
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    throw new UsageError(`Unknown argument: ${arg}`);
  }

  return options;
}
