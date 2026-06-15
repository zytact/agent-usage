import type { Scope } from "./report-core.js";

const SECTION_KEYS = [
  "request-summary",
  "gpt-only-request-summary",
  "daily-usage",
  "daily-breakdown",
  "source-share",
  "model-breakdown",
  "token-mix",
  "top-repos",
  "source-sections",
  "source-section-languages",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const DEFAULT_SECTIONS: SectionKey[] = [
  "request-summary",
  "daily-usage",
  "source-share",
  "model-breakdown",
  "token-mix",
  "top-repos",
  "source-sections",
];

export const ALL_SECTIONS: SectionKey[] = [...SECTION_KEYS];

export const SECTION_LABELS: Record<SectionKey, string> = {
  "request-summary": "Request summary",
  "gpt-only-request-summary": "GPT-only request summary",
  "daily-usage": "Daily usage",
  "daily-breakdown": "Daily model breakdown",
  "source-share": "Source share",
  "model-breakdown": "Model breakdown",
  "token-mix": "Token mix",
  "top-repos": "Top repos",
  "source-sections": "Per-source sections",
  "source-section-languages": "Language stats in per-source sections",
};

const SECTION_KEY_SET = new Set<string>(SECTION_KEYS);

function isSectionKey(value: string): value is SectionKey {
  return SECTION_KEY_SET.has(value);
}

export function normalizeSectionList(values: string[]): SectionKey[] {
  const out: SectionKey[] = [];
  const seen = new Set<SectionKey>();
  for (const value of values) {
    if (!isSectionKey(value)) {
      throw new Error(`Invalid --section: ${value}`);
    }
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export function defaultSectionsForScope(scope: Scope): SectionKey[] {
  return scope === "today"
    ? DEFAULT_SECTIONS.filter((section) => section !== "daily-usage")
    : DEFAULT_SECTIONS;
}

export function availableSectionsForScope(scope: Scope): SectionKey[] {
  return scope === "today"
    ? ALL_SECTIONS.filter((section) => section !== "daily-usage")
    : ALL_SECTIONS;
}

export function sanitizeSectionsForScope(scope: Scope, sections: SectionKey[]): SectionKey[] {
  const allowed = new Set(availableSectionsForScope(scope));
  return sections.filter((section) => allowed.has(section));
}

export function validateSectionsForScope(scope: Scope, sections: SectionKey[]): void {
  const invalid = sections.filter((section) => !availableSectionsForScope(scope).includes(section));
  if (invalid.length > 0) {
    throw new Error(`Invalid for --scope=${scope}: ${invalid.join(", ")}`);
  }
}

export function inferSectionModeForScope(
  scope: Scope,
  sections: SectionKey[],
): "summary" | "full" | "custom" {
  const defaults = defaultSectionsForScope(scope);
  const all = availableSectionsForScope(scope);
  if (
    sections.length === defaults.length &&
    defaults.every((section, index) => sections[index] === section)
  ) {
    return "summary";
  }
  if (
    sections.length === all.length &&
    all.every((section, index) => sections[index] === section)
  ) {
    return "full";
  }
  return "custom";
}
