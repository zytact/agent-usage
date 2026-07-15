import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { defaultDiscoveryRoots, discoverSessionFiles } from "../src/discovery.js";
import { useTempDirs } from "./fixtures.js";

const tempDirs = useTempDirs();

describe("discoverSessionFiles", () => {
  it("finds nested jsonl sources and db path", async () => {
    const roots = await makeDiscoveryRoots();
    await mkdir(join(roots.codexDir, "2026", "06", "14"), { recursive: true });
    await mkdir(join(roots.piDir, "repo"), { recursive: true });
    await mkdir(join(roots.claudeDir, "project-a"), { recursive: true });
    await mkdir(roots.opencodeDir, { recursive: true });
    await mkdir(join(roots.piWorkflowsDir, "project-a", "runs"), { recursive: true });

    await writeFile(join(roots.codexDir, "2026", "06", "14", "one.jsonl"), "");
    await writeFile(join(roots.piDir, "repo", "two.jsonl"), "");
    await writeFile(join(roots.claudeDir, "project-a", "three.jsonl"), "");
    await writeFile(join(roots.piWorkflowsDir, "project-a", "runs", "four.json"), "");

    const discovered = await discoverSessionFiles(roots);

    expect(discovered).toEqual({
      claudeFiles: [
        {
          mtimeMs: discovered.claudeFiles[0]?.mtimeMs,
          path: join(roots.claudeDir, "project-a", "three.jsonl"),
          size: 0,
        },
      ],
      codexFiles: [
        {
          mtimeMs: discovered.codexFiles[0]?.mtimeMs,
          path: join(roots.codexDir, "2026", "06", "14", "one.jsonl"),
          size: 0,
        },
      ],
      opencodeDbPath: join(roots.opencodeDir, "opencode.db"),
      piFiles: [
        {
          mtimeMs: discovered.piFiles[0]?.mtimeMs,
          path: join(roots.piDir, "repo", "two.jsonl"),
          size: 0,
        },
      ],
      piWorkflowFiles: [
        {
          mtimeMs: discovered.piWorkflowFiles[0]?.mtimeMs,
          path: join(roots.piWorkflowsDir, "project-a", "runs", "four.json"),
          size: 0,
        },
      ],
    });
  });

  it("skips files before the scope cutoff", async () => {
    const roots = await makeDiscoveryRoots();
    await mkdir(join(roots.codexDir, "2026", "06", "12"), { recursive: true });
    await mkdir(join(roots.codexDir, "2026", "06", "14"), { recursive: true });
    await mkdir(join(roots.piDir, "repo"), { recursive: true });
    await mkdir(join(roots.piWorkflowsDir, "misleading-2020-01-01", "runs"), {
      recursive: true,
    });

    await writeFile(join(roots.codexDir, "2026", "06", "12", "old.jsonl"), "");
    await writeFile(join(roots.codexDir, "2026", "06", "14", "new.jsonl"), "");
    const oldPiFile = join(roots.piDir, "repo", "old-pi.jsonl");
    const newPiFile = join(roots.piDir, "repo", "new-pi.jsonl");
    await writeFile(oldPiFile, "");
    await writeFile(newPiFile, "");
    const workflowFile = join(
      roots.piWorkflowsDir,
      "misleading-2020-01-01",
      "runs",
      "in-scope.json",
    );
    await writeFile(workflowFile, "");
    await utimes(workflowFile, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    await utimes(oldPiFile, new Date("2026-06-12T00:00:00Z"), new Date("2026-06-12T00:00:00Z"));
    await utimes(newPiFile, new Date("2026-06-14T12:00:00Z"), new Date("2026-06-14T12:00:00Z"));

    const discovered = await discoverSessionFiles(roots, new Date("2026-06-14T00:00:00Z"));

    expect(discovered.codexFiles.map((file) => file.path)).toEqual([
      join(roots.codexDir, "2026", "06", "14", "new.jsonl"),
    ]);
    expect(discovered.piFiles.map((file) => file.path)).toEqual([newPiFile]);
    expect(discovered.piWorkflowFiles.map((file) => file.path)).toEqual([workflowFile]);
  });
});

async function makeDiscoveryRoots(): Promise<ReturnType<typeof defaultDiscoveryRoots>> {
  const home = await mkdtemp(join(tmpdir(), "agent-usage-discovery-"));
  tempDirs.push(home);
  return defaultDiscoveryRoots(home);
}
