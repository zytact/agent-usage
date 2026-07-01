import type { SourceSection } from "./report-data.js";

export type SectionDisplayMode = "summary" | "full" | "custom";

export function isPrimarySection(section: SourceSection): boolean {
  return section.kind === "primary";
}

export function shouldShowSection(
  section: SourceSection,
  mode: SectionDisplayMode,
  showOriginators: boolean,
): boolean {
  if (section.kind === "combined" || section.kind === "gptOnly") {
    return false;
  }
  if (section.kind === "originator") {
    return showOriginators;
  }
  return mode === "full" ? true : isPrimarySection(section);
}
