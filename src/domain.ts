export type SourceId = "claude" | "codex" | "opencode" | "pi";

export type TokenUsage = {
  cacheWrite: number;
  cached: number;
  input: number;
  output: number;
  reasoning: number;
  total: number;
};

export type SessionRequest = {
  cacheRead: number;
  cacheReadRatio: number;
  cacheWrite: number;
  contextSize: number;
  date: string;
  effort: string;
  input: number;
  model: string;
  output: number;
  reasoning: number;
  repo: string;
  sessionId: string;
  source: SourceId;
  sourceLabel: string;
  subharness: string;
  total: number;
  ts: Date;
  uncachedInput: number;
};

export type ParsedSession = {
  activeSeconds: number;
  assistantTurns: number;
  cwd?: string;
  dayModelActiveSeconds: Record<string, Record<string, number>>;
  dayStateActiveSeconds: Record<string, Record<string, number>>;
  end: Date;
  efforts: Record<string, number>;
  languages: Record<string, number>;
  modelActiveSeconds: Record<string, number>;
  modelTokens: Record<string, TokenUsage & { billableOutput: number }>;
  models: Record<string, number>;
  originator?: string;
  path: string;
  repo: string;
  requestCount: number;
  requests: SessionRequest[];
  sessionId: string;
  source: SourceId;
  sourceLabel: string;
  start: Date;
  stateActiveSeconds: Record<string, number>;
  tokens: TokenUsage;
  userTurns: number;
};

export type DiscoveredSessionFile = {
  mtimeMs: number;
  path: string;
  size: number;
};

export type SessionDiscovery = {
  claudeFiles: DiscoveredSessionFile[];
  codexFiles: DiscoveredSessionFile[];
  opencodeDbPath: string;
  piFiles: DiscoveredSessionFile[];
};
