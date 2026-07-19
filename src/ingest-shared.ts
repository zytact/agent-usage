import { basename, extname } from "node:path";

import type { SessionRequest, SourceId, TokenUsage } from "./domain.js";

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

const FILE_PATH_RE = /([/~]?[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)/g;

export function repoName(cwd: string | undefined): string {
  if (!cwd) {
    return "unknown";
  }

  const name = basename(cwd);
  return name || cwd;
}

export function inferLanguages(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of text.matchAll(FILE_PATH_RE)) {
    const extension = extname(match[1]).toLowerCase();
    const language = EXTENSION_LANGUAGES[extension];
    if (language) {
      counts[language] = (counts[language] ?? 0) + 1;
    }
  }
  return counts;
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
    cached: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  };
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
    cacheWriteAvailability: telemetry?.cacheWrite ?? "known",
    contextSize,
    date: ts.toISOString().slice(0, 10),
    effort: effort ?? "unknown",
    input: tokens.input,
    model: model ?? "unknown",
    output: tokens.output,
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
