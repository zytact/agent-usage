import { basename } from "node:path";

import type { ModelTokenUsage, SessionRequest, SourceId, TokenUsage } from "./domain.js";
import { calendarDate } from "./report-core.js";

const ORIGINATOR_LABELS: Partial<Record<SourceId, Record<string, string>>> = {
  claude: {
    cli: "CLI",
    sdk: "SDK",
    "sdk-cli": "SDK CLI",
    "sdk-ts": "SDK TS",
    subagent: "Subagent",
  },
  codex: {
    "codex-tui": "TUI",
    "codex desktop": "Desktop",
    subagent: "Subagent",
    t3code_desktop: "T3 Code",
  },
  opencode: {
    opencode: "Direct",
    subagent: "Subagent",
    t3code_desktop: "T3 Code",
  },
  pi: {
    direct: "Direct",
    subagent: "Subagent",
  },
};

const EXTENSION_LANGUAGES: Record<string, string> = {
  ".bash": "Shell",
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".css": "CSS",
  ".go": "Go",
  ".h": "C/C++ Header",
  ".hpp": "C++ Header",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".json": "JSON",
  ".jsonl": "JSONL",
  ".jsx": "JSX",
  ".kt": "Kotlin",
  ".lua": "Lua",
  ".md": "Markdown",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scss": "SCSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".swift": "Swift",
  ".toml": "TOML",
  ".ts": "TypeScript",
  ".tsx": "TSX",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".zsh": "Shell",
};

/**
 * Both patterns end in a single greedy character class with nothing to satisfy after it,
 * so neither can backtrack. Matching a path and its extension in one pattern instead makes
 * the engine retry every split point of long non-path runs such as embedded base64 image
 * data, which costs time quadratic in the line length.
 */
const PATH_TOKEN_RE = /[A-Za-z0-9._/~-]+/g;
const EXTENSION_RE = /\.[A-Za-z0-9]+/g;

export function repoName(cwd: string | undefined): string {
  if (!cwd) {
    return "unknown";
  }

  const name = basename(cwd);
  return name || cwd;
}

export function inferLanguages(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of text.matchAll(PATH_TOKEN_RE)) {
    const language = EXTENSION_LANGUAGES[lastExtension(token[0])];
    if (language) {
      counts[language] = (counts[language] ?? 0) + 1;
    }
  }
  return counts;
}

/** Trailing extension of a path-like token, ignoring any junk after it: `src/a.ts.` is `.ts`. */
function lastExtension(token: string): string {
  let extension = "";
  for (const match of token.matchAll(EXTENSION_RE)) {
    extension = match[0];
  }
  return extension.toLowerCase();
}

export function mergeCounts(
  target: Record<string, number>,
  source: Record<string, number>,
): Record<string, number> {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
  return target;
}

export function zeroTokens(): TokenUsage {
  return {
    cacheWrite: 0,
    cacheWrite1h: 0,
    cached: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  };
}

/**
 * A bucket keeps its provider only while every contribution agrees, so mixed providers fall
 * back to the model publisher rather than picking one arbitrarily. Call this before adding
 * tokens: an empty bucket has no provider yet and takes the first contribution's.
 */
export function narrowProvider(bucket: ModelTokenUsage, provider: string | undefined): void {
  if (bucket.total === 0 && bucket.provider === undefined) {
    bucket.provider = provider;
    return;
  }
  if (bucket.provider !== provider) {
    bucket.provider = undefined;
  }
}

export function originatorLabel(
  source: SourceId,
  originator: string | undefined,
): string | undefined {
  const key = normalizeOriginatorKey(originator);
  if (!key) {
    return undefined;
  }
  const mapped = ORIGINATOR_LABELS[source]?.[key];
  if (mapped) {
    return mapped;
  }
  return humanizeOriginator(originator ?? key);
}

export function sessionLabel(source: SourceId, originator: string | undefined): string {
  const label = originatorLabel(source, originator);
  if (label === "T3 Code") {
    return label;
  }
  if (source === "claude") {
    return "Claude Code";
  }
  if (source === "pi") {
    return "Pi";
  }
  return source;
}

function subharnessName(source: SourceId, originator: string | undefined): string {
  if (originatorLabel(source, originator) === "T3 Code") {
    return "t3code";
  }
  return source;
}

function normalizeOriginatorKey(originator: string | undefined): string | undefined {
  if (!originator) {
    return undefined;
  }
  const value = originator.trim();
  return value ? value.toLowerCase() : undefined;
}

function humanizeOriginator(originator: string): string {
  return originator
    .trim()
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function addRequest(
  requests: SessionRequest[],
  {
    effort,
    model,
    originator,
    provider,
    repo,
    sessionId,
    source,
    telemetry,
    tokens,
    ts,
  }: {
    effort?: string;
    model?: string;
    originator?: string;
    provider?: string;
    repo: string;
    sessionId: string;
    source: SourceId;
    telemetry?: {
      cacheWrite?: SessionRequest["cacheWriteAvailability"];
      reasoning?: SessionRequest["reasoningAvailability"];
    };
    tokens: TokenUsage;
    ts?: Date;
  },
): void {
  if (!ts) {
    return;
  }

  const contextSize = tokens.input + tokens.cached + tokens.cacheWrite;
  requests.push({
    cacheRead: tokens.cached,
    cacheReadRatio: contextSize > 0 ? tokens.cached / contextSize : 0,
    cacheWrite: tokens.cacheWrite,
    cacheWrite1h: tokens.cacheWrite1h,
    cacheWriteAvailability: telemetry?.cacheWrite ?? "known",
    contextSize,
    date: calendarDate(ts),
    effort: effort ?? "unknown",
    input: tokens.input,
    model: model ?? "unknown",
    output: tokens.output,
    provider,
    reasoning: tokens.reasoning,
    reasoningAvailability: telemetry?.reasoning ?? "known",
    repo,
    sessionId,
    source,
    sourceLabel: sessionLabel(source, originator),
    subharness: subharnessName(source, originator),
    total: tokens.total || contextSize + tokens.output + tokens.reasoning,
    ts,
    uncachedInput: tokens.input + tokens.cacheWrite,
  });
}
