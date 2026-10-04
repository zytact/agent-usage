import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vite-plus/test";

describe("project skills", () => {
  it("keeps the Claude Code copy byte-identical to the Codex copy", async () => {
    const [agents, claude] = await Promise.all([
      readTree(".agents/skills"),
      readTree(".claude/skills"),
    ]);

    expect(claude).toEqual(agents);
  });
});

async function readTree(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const contents = await Promise.all(
    files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(root, path), await readFile(path, "base64")] as const;
    }),
  );
  return Object.fromEntries(contents.sort(([a], [b]) => a.localeCompare(b)));
}
