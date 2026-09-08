import { existsSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { DiscoveredSessionFile, SessionDiscovery } from "./domain.js";

type DiscoveryRoots = {
  claudeDir: string;
  codexDir: string;
  homeDir: string;
  opencodeDir: string;
  piDir: string;
  piWorkflowsDir: string;
};

/**
 * Pi resolves its session root the same way: PI_CODING_AGENT_SESSION_DIR wins outright,
 * otherwise sessions live under PI_CODING_AGENT_DIR (default ~/.pi/agent).
 */
export function defaultDiscoveryRoots(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): DiscoveryRoots {
  const piAgentDir = expandHome(env.PI_CODING_AGENT_DIR, homeDir) ?? join(homeDir, ".pi", "agent");

  return {
    claudeDir: join(homeDir, ".claude", "projects"),
    codexDir: join(homeDir, ".codex", "sessions"),
    homeDir,
    opencodeDir: join(homeDir, ".local", "share", "opencode"),
    piDir: expandHome(env.PI_CODING_AGENT_SESSION_DIR, homeDir) ?? join(piAgentDir, "sessions"),
    piWorkflowsDir: join(homeDir, ".pi", "workflows", "projects"),
  };
}

function expandHome(value: string | undefined, homeDir: string): string | undefined {
  const path = value?.trim();
  if (!path) {
    return undefined;
  }
  if (path === "~") {
    return homeDir;
  }
  if (path.startsWith("~/")) {
    return join(homeDir, path.slice(2));
  }
  return isAbsolute(path) ? path : resolve(path);
}

export async function discoverSessionFiles(
  roots: DiscoveryRoots,
  scopeStart?: Date,
): Promise<SessionDiscovery> {
  const cutoffMs = scopeStart?.getTime();
  const [claudeFiles, codexFiles, piFiles, piWorkflowFiles] = await Promise.all([
    collectFiles(roots.claudeDir, ".jsonl", cutoffMs),
    collectFiles(roots.codexDir, ".jsonl", cutoffMs),
    collectFiles(roots.piDir, ".jsonl", cutoffMs),
    // Workflow project names and file mtimes are not lifecycle timestamps. Parse
    // candidates and apply Scope using completedAt instead.
    collectFiles(roots.piWorkflowsDir, ".json"),
  ]);

  return {
    claudeFiles,
    codexFiles,
    opencodeDbPath: join(roots.opencodeDir, "opencode.db"),
    piFiles,
    piWorkflowFiles,
  };
}

async function collectFiles(
  root: string,
  suffix: string,
  cutoffMs?: number,
): Promise<DiscoveredSessionFile[]> {
  if (!existsSync(root)) {
    return [];
  }

  const files: DiscoveredSessionFile[] = [];
  await walk(root, suffix, files, cutoffMs);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function walk(
  root: string,
  suffix: string,
  files: DiscoveredSessionFile[],
  cutoffMs?: number,
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, suffix, files, cutoffMs);
      continue;
    }
    if (!isMatchingFileEntry(entry, suffix)) {
      continue;
    }
    await addDiscoveredFile(fullPath, files, cutoffMs);
  }
}

/**
 * Modification time is the only trustworthy freshness signal. Session filenames and the
 * dated directories above them record creation, so a resumed session keeps an old name
 * while still gaining requests inside Scope.
 */
async function addDiscoveredFile(
  fullPath: string,
  files: DiscoveredSessionFile[],
  cutoffMs?: number,
): Promise<void> {
  const fileStat = await stat(fullPath);
  if (cutoffMs && fileStat.mtimeMs < cutoffMs) {
    return;
  }

  files.push({
    mtimeMs: fileStat.mtimeMs,
    path: fullPath,
    size: fileStat.size,
  });
}

function isMatchingFileEntry(entry: Dirent, suffix: string): boolean {
  return entry.isFile() && entry.name.endsWith(suffix);
}
