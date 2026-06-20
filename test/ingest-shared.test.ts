import { describe, expect, it } from "vite-plus/test";

import { originatorLabel, sessionLabel } from "../src/ingest-shared.js";

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
    expect(originatorLabel("codex", "t3code_desktop")).toBe("T3 Code");
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
