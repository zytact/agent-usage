import { describe, expect, it } from "vite-plus/test";

import { inferLanguages, originatorLabel, sessionLabel } from "../src/ingest-shared.js";

describe("originator labels", () => {
  it("maps claude originators", () => {
    expect(originatorLabel("claude", "cli")).toBe("CLI");
    expect(originatorLabel("claude", "sdk")).toBe("SDK");
    expect(originatorLabel("claude", "sdk-cli")).toBe("SDK CLI");
    expect(originatorLabel("claude", "sdk-ts")).toBe("SDK TS");
    expect(originatorLabel("claude", "subagent")).toBe("Subagent");
  });

  it("maps codex originators", () => {
    expect(originatorLabel("codex", "codex-tui")).toBe("TUI");
    expect(originatorLabel("codex", "Codex Desktop")).toBe("Desktop");
    expect(originatorLabel("codex", "subagent")).toBe("Subagent");
    expect(originatorLabel("codex", "t3code_desktop")).toBe("T3 Code");
  });

  it("maps pi originators", () => {
    expect(originatorLabel("pi", "direct")).toBe("Direct");
    expect(originatorLabel("pi", "subagent")).toBe("Subagent");
  });

  it("maps opencode originators", () => {
    expect(originatorLabel("opencode", "opencode")).toBe("Direct");
    expect(originatorLabel("opencode", "subagent")).toBe("Subagent");
    expect(originatorLabel("opencode", "t3code_desktop")).toBe("T3 Code");
  });

  it("humanizes unknown originators", () => {
    expect(originatorLabel("codex", "custom_worker-agent")).toBe("Custom Worker Agent");
  });

  it("keeps harness labels stable", () => {
    expect(sessionLabel("claude", "sdk-cli")).toBe("Claude Code");
    expect(sessionLabel("opencode", "subagent")).toBe("opencode");
    expect(sessionLabel("codex", "t3code_desktop")).toBe("T3 Code");
    expect(sessionLabel("pi", undefined)).toBe("Pi");
  });
});

describe("inferLanguages", () => {
  it("counts languages from paths and bare extensions", () => {
    expect(inferLanguages('{"file":"src/report.ts","also":"~/notes.md"}')).toEqual({
      TypeScript: 1,
      Markdown: 1,
    });
    expect(inferLanguages("see src/a.ts. and `.jsonl` files")).toEqual({
      TypeScript: 1,
      JSONL: 1,
    });
    expect(inferLanguages("a.ts/b.py")).toEqual({ Python: 1 });
  });

  it("stays linear on long runs that are not paths", () => {
    const started = performance.now();
    inferLanguages("a".repeat(400_000));
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
