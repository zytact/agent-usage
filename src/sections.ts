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

export const DETAIL_SECTIONS: SectionKey[] = ALL_SECTIONS.filter(
  (section) => !DEFAULT_SECTIONS.includes(section),
);

export function inferSectionMode(sections: SectionKey[]): "summary" | "full" | "custom" {
  const sameLength = sections.length === DEFAULT_SECTIONS.length;
  if (sameLength && DEFAULT_SECTIONS.every((section, index) => sections[index] === section)) {
    return "summary";
  }
  if (
    sections.length === ALL_SECTIONS.length &&
    ALL_SECTIONS.every((section, index) => sections[index] === section)
  ) {
    return "full";
  }
  return "custom";
}
