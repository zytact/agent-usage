import { describe, expect, it } from "vite-plus/test";

import { parseArgs, UsageError } from "../src/args.js";

describe("parseArgs", () => {
  it("parses defaults", () => {
    expect(parseArgs([])).toEqual({
      html: false,
      help: false,
      reportMode: "summary",
      showOriginators: false,
    });
  });

  it("parses explicit flags", () => {
    expect(
      parseArgs([
        "--claude",
        "--codex",
        "--scope",
        "1d",
        "--full",
        "--originators",
        "--html",
        "report.html",
      ]),
    ).toEqual({
      scope: "1d",
      html: true,
      htmlPath: "report.html",
      help: false,
      reportMode: "full",
      showOriginators: true,
      sources: ["claude", "codex"],
    });
  });

  it("parses equals syntax", () => {
    expect(parseArgs(["--scope=30d", "--html=-"])).toEqual({
      scope: "30d",
      html: true,
      htmlPath: "-",
      help: false,
      reportMode: "summary",
      showOriginators: false,
    });
  });

  it("parses sections", () => {
    expect(
      parseArgs([
        "--section",
        "request-summary,daily-usage",
        "--section=source-sections,token-mix",
      ]),
    ).toEqual({
      html: false,
      help: false,
      reportMode: "summary",
      sections: ["request-summary", "daily-usage", "source-sections", "token-mix"],
      showOriginators: false,
    });
  });

  it("keeps help separate", () => {
    expect(parseArgs(["--help"])).toEqual({
      html: false,
      help: true,
      reportMode: "summary",
      showOriginators: false,
    });
  });

  it("rejects missing scope value", () => {
    expect(() => parseArgs(["--scope"])).toThrowError(new UsageError("Missing value for --scope"));
  });

  it("rejects invalid scope", () => {
    expect(() => parseArgs(["--scope", "90d"])).toThrowError(
      new UsageError("Invalid --scope: 90d"),
    );
  });

  it("rejects invalid section", () => {
    expect(() => parseArgs(["--section", "wat"])).toThrowError(
      new UsageError("Invalid --section: wat"),
    );
  });

  it("rejects daily-usage when scope is today", () => {
    expect(() => parseArgs(["--scope", "today", "--section", "daily-usage"])).toThrowError(
      new UsageError("Invalid for --scope=today: daily-usage"),
    );
  });

  it("rejects --full with --section", () => {
    expect(() => parseArgs(["--full", "--section", "request-summary"])).toThrowError(
      new UsageError("Cannot use --section with --full"),
    );
  });

  it("rejects unknown args", () => {
    expect(() => parseArgs(["--wat"])).toThrowError(new UsageError("Unknown argument: --wat"));
  });
});
