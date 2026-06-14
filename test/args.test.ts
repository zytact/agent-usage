import { describe, expect, it } from "vite-plus/test";

import { parseArgs, UsageError } from "../src/args.js";

describe("parseArgs", () => {
  it("parses defaults", () => {
    expect(parseArgs([])).toEqual({
      includeClaude: false,
      html: false,
      help: false,
      reportMode: "summary",
    });
  });

  it("parses explicit flags", () => {
    expect(parseArgs(["--claude", "--scope", "1d", "--full", "--html", "report.html"])).toEqual({
      includeClaude: true,
      scope: "1d",
      html: true,
      htmlPath: "report.html",
      help: false,
      reportMode: "full",
    });
  });

  it("parses equals syntax", () => {
    expect(parseArgs(["--scope=30d", "--html=-"])).toEqual({
      includeClaude: false,
      scope: "30d",
      html: true,
      htmlPath: "-",
      help: false,
      reportMode: "summary",
    });
  });

  it("keeps help separate", () => {
    expect(parseArgs(["--help"])).toEqual({
      includeClaude: false,
      html: false,
      help: true,
      reportMode: "summary",
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

  it("rejects unknown args", () => {
    expect(() => parseArgs(["--wat"])).toThrowError(new UsageError("Unknown argument: --wat"));
  });
});
