import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { SessionDiscovery } from "./domain.js";

type DiscoveryRoots = {
  claudeDir: string;
  codexDir: string;
  homeDir: string;
  opencodeDir: string;
  piDir: string;
};

export function defaultDiscoveryRoots(homeDir: string): DiscoveryRoots {
  return {
    claudeDir: join(homeDir, ".claude", "projects"),
    codexDir: join(homeDir, ".codex", "sessions"),
    homeDir,
    opencodeDir: join(homeDir, ".local", "share", "opencode"),
    piDir: join(homeDir, ".pi", "agent", "sessions"),
  };
}

export async function discoverSessionFiles(roots: DiscoveryRoots): Promise<SessionDiscovery> {
  return {
    claudeFiles: await collectFiles(roots.claudeDir, ".jsonl"),
    codexFiles: await collectFiles(roots.codexDir, ".jsonl"),
    opencodeDbPath: join(roots.opencodeDir, "opencode.db"),
    piFiles: await collectFiles(roots.piDir, ".jsonl"),
  };
}

async function collectFiles(root: string, suffix: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  await walk(root, suffix, files);
  files.sort();
  return files;
}

async function walk(root: string, suffix: string, files: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, suffix, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(fullPath);
    }
  }
}
