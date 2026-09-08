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

  it("skips files whose contents were last written before the scope cutoff", async () => {
    const roots = await makeDiscoveryRoots();
    await mkdir(join(roots.codexDir, "2026", "06", "12"), { recursive: true });
    await mkdir(join(roots.codexDir, "2026", "06", "14"), { recursive: true });
    await mkdir(join(roots.piDir, "repo"), { recursive: true });
    await mkdir(join(roots.piWorkflowsDir, "misleading-2020-01-01", "runs"), {
      recursive: true,
    });

    const oldCodexFile = join(roots.codexDir, "2026", "06", "12", "old.jsonl");
    const newCodexFile = join(roots.codexDir, "2026", "06", "14", "new.jsonl");
    const oldPiFile = join(roots.piDir, "repo", "old-pi.jsonl");
    const newPiFile = join(roots.piDir, "repo", "new-pi.jsonl");
    const workflowFile = join(
      roots.piWorkflowsDir,
      "misleading-2020-01-01",
      "runs",
      "in-scope.json",
    );
    for (const file of [oldCodexFile, newCodexFile, oldPiFile, newPiFile, workflowFile]) {
      await writeFile(file, "");
    }
    await setMtime(workflowFile, "2020-01-01T00:00:00Z");
    await setMtime(oldCodexFile, "2026-06-12T00:00:00Z");
    await setMtime(newCodexFile, "2026-06-14T12:00:00Z");
    await setMtime(oldPiFile, "2026-06-12T00:00:00Z");
    await setMtime(newPiFile, "2026-06-14T12:00:00Z");

    const discovered = await discoverSessionFiles(roots, new Date("2026-06-14T00:00:00Z"));

    expect(discovered.codexFiles.map((file) => file.path)).toEqual([newCodexFile]);
    expect(discovered.piFiles.map((file) => file.path)).toEqual([newPiFile]);
    expect(discovered.piWorkflowFiles.map((file) => file.path)).toEqual([workflowFile]);
  });

  it("keeps resumed sessions whose filename predates the scope cutoff", async () => {
    const roots = await makeDiscoveryRoots();
    await mkdir(join(roots.codexDir, "2026", "06", "12"), { recursive: true });
    await mkdir(join(roots.piDir, "repo"), { recursive: true });

    const codexFile = join(roots.codexDir, "2026", "06", "12", "resumed.jsonl");
    const piFile = join(roots.piDir, "repo", "2026-06-12T00-00-00-000Z_resumed.jsonl");
    await writeFile(codexFile, "");
    await writeFile(piFile, "");
    await setMtime(codexFile, "2026-06-14T12:00:00Z");
    await setMtime(piFile, "2026-06-14T12:00:00Z");

    const discovered = await discoverSessionFiles(roots, new Date("2026-06-14T00:00:00Z"));

    expect(discovered.codexFiles.map((file) => file.path)).toEqual([codexFile]);
    expect(discovered.piFiles.map((file) => file.path)).toEqual([piFile]);
  });

  it("honours pi session directory environment overrides", async () => {
    const home = "/home/someone";

    expect(defaultDiscoveryRoots(home, {}).piDir).toBe("/home/someone/.pi/agent/sessions");
    expect(defaultDiscoveryRoots(home, { PI_CODING_AGENT_DIR: "~/elsewhere" }).piDir).toBe(
      "/home/someone/elsewhere/sessions",
    );
    expect(
      defaultDiscoveryRoots(home, {
        PI_CODING_AGENT_DIR: "/opt/pi",
        PI_CODING_AGENT_SESSION_DIR: "/data/pi-sessions",
      }).piDir,
    ).toBe("/data/pi-sessions");
  });
});

async function setMtime(path: string, iso: string): Promise<void> {
  await utimes(path, new Date(iso), new Date(iso));
}

async function makeDiscoveryRoots(): Promise<ReturnType<typeof defaultDiscoveryRoots>> {
  const home = await mkdtemp(join(tmpdir(), "agent-usage-discovery-"));
  tempDirs.push(home);
  return defaultDiscoveryRoots(home, {});
}
