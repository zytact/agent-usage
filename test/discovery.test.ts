import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { defaultDiscoveryRoots, discoverSessionFiles } from "../src/discovery.js";
import { useTempDirs } from "./fixtures.js";

const tempDirs = useTempDirs();

describe("discoverSessionFiles", () => {
  it("finds nested jsonl sources and db path", async () => {
    const home = await mkdtemp(join(tmpdir(), "agent-usage-discovery-"));
    tempDirs.push(home);

    const roots = defaultDiscoveryRoots(home);
    await mkdir(join(roots.codexDir, "2026", "06", "14"), { recursive: true });
    await mkdir(join(roots.piDir, "repo"), { recursive: true });
    await mkdir(join(roots.claudeDir, "project-a"), { recursive: true });
    await mkdir(roots.opencodeDir, { recursive: true });

    await writeFile(join(roots.codexDir, "2026", "06", "14", "one.jsonl"), "");
    await writeFile(join(roots.piDir, "repo", "two.jsonl"), "");
    await writeFile(join(roots.claudeDir, "project-a", "three.jsonl"), "");

    const discovered = await discoverSessionFiles(roots);

    expect(discovered).toEqual({
      claudeFiles: [join(roots.claudeDir, "project-a", "three.jsonl")],
      codexFiles: [join(roots.codexDir, "2026", "06", "14", "one.jsonl")],
      opencodeDbPath: join(roots.opencodeDir, "opencode.db"),
      piFiles: [join(roots.piDir, "repo", "two.jsonl")],
    });
  });
});
