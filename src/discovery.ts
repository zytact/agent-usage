import { existsSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { DiscoveredSessionFile, SessionDiscovery } from "./domain.js";

type DiscoveryRoots = {
  claudeDir: string;
  codexDir: string;
  homeDir: string;
  opencodeDir: string;
  piDir: string;
  piWorkflowsDir: string;
};

export function defaultDiscoveryRoots(homeDir: string): DiscoveryRoots {
  return {
    claudeDir: join(homeDir, ".claude", "projects"),
    codexDir: join(homeDir, ".codex", "sessions"),
    homeDir,
    opencodeDir: join(homeDir, ".local", "share", "opencode"),
    piDir: join(homeDir, ".pi", "agent", "sessions"),
    piWorkflowsDir: join(homeDir, ".pi", "workflows", "projects"),
  };
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
  await walk(root, root, suffix, files, cutoffMs);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function walk(
  root: string,
  walkRoot: string,
  suffix: string,
  files: DiscoveredSessionFile[],
  cutoffMs?: number,
): Promise<void> {
  if (shouldSkipByPath(root, walkRoot, cutoffMs)) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, walkRoot, suffix, files, cutoffMs);
      continue;
    }
    if (!isMatchingFileEntry(entry, suffix)) {
      continue;
    }
    if (shouldSkipByPath(fullPath, walkRoot, cutoffMs)) {
      continue;
    }
    await addDiscoveredFile(fullPath, files, cutoffMs);
  }
}

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

function shouldSkipByPath(fullPath: string, root: string, cutoffMs?: number): boolean {
  return cutoffMs ? definitelyBeforeScope(fullPath, root, cutoffMs) : false;
}

function definitelyBeforeScope(fullPath: string, root: string, cutoffMs: number): boolean {
  const hinted = dateHintFromPath(relative(root, fullPath));
  return hinted ? hinted.getTime() < cutoffMs : false;
}

function dateHintFromPath(relativePath: string): Date | undefined {
  const parts = relativePath.split(sep).filter(Boolean);
  if (parts.length >= 3) {
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      return new Date(Date.UTC(year, month - 1, day + 1));
    }
  }

  const match = (parts.at(-1) ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
}
