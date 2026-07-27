# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who use one or more coding-agent Sources and want a trustworthy local view of how their Active time, Requests, tokens, models, Repositories, and Estimated cost are distributed. They inspect the Usage dossier to understand patterns quickly, then move into deeper diagnostics when something deserves attention.

## Product Purpose

Agent Usage turns local coding-agent Session history into a coherent Usage dossier. It should make the overall shape of activity legible at a glance while preserving enough detail for technical investigation. Success means users can orient themselves quickly, compare Sources and models accurately, and leave with a clearer understanding of their working habits and resource use.

## Positioning

Agent Usage unifies local Session histories from multiple coding-agent Sources without requiring those histories to be uploaded. Source-specific parsers, explicit Telemetry availability, and workflow attribution rules keep differences and missing data visible instead of silently treating unlike records as equivalent.

## Operating Context

Users run Agent Usage locally as an interactive CLI or with explicit flags. It reads supported coding-agent history from local stores, filters Sessions by Scope, and produces either a Terminal report or a self-contained HTML report. Users can choose Summary mode, Full mode, individual Sections, and optional Originator breakdowns.

Supported Sources and their local stores are documented in `README.md`. Canonical domain terminology and relationships are documented in `UBIQUITOUS_LANGUAGE.md`.

## Capabilities and Constraints

- Supported Sources are Codex, opencode, Pi, and Claude Code.
- Usage dossiers include Active time, Sessions, Requests, token categories, model and effort breakdowns, Repositories, daily usage, and Estimated cost when the required data is available.
- Telemetry availability is explicit. Missing, partial, and known token categories must remain distinguishable.
- Active time is inferred from event gaps and is not wall-clock duration.
- Estimated cost is approximate and depends on available model pricing and observed token data.
- Pi workflow records may provide aggregate accounting rather than request-level detail. Explicit workflow lineage is used to prevent duplicate accounting when persisted subagent Sessions overlap aggregate records.
- The HTML report is standalone and reads no network resources. Source collection and available detail remain constrained by local history formats and the telemetry each Source records.

## Brand Commitments

The product name is Agent Usage. Its voice is precise, calm, technical, and quietly engaging. It should feel expertly instrumented without becoming clinical or sterile. Visual identity and interface rules are maintained separately in `DESIGN.md`.

## Evidence on Hand

- `README.md` documents the supported Sources, local data stores, CLI workflow, report modes, and output formats.
- `src/parsers/` and `src/runtime.ts` implement Source ingestion and local report generation.
- `test/` contains parser fixtures and behavioral coverage for ingestion, accounting, rendering, and CLI behavior.
- `UBIQUITOUS_LANGUAGE.md` defines the domain model and canonical product terminology.
- `DESIGN.md` records the incumbent visual system.
- No testimonials, case studies, customer logos, or external performance benchmarks are currently part of the repository and must not be fabricated.

## Product Principles

1. Preserve analytical trust. Comparisons, labels, units, and accounting rules must remain explicit and consistent.
2. Keep local data local. Generate useful analysis from local history without requiring users to upload it.
3. Reveal data boundaries. Show missing, partial, inferred, and aggregate data truthfully.
4. Support orientation before diagnosis. Make the overall shape of Agent usage quick to understand while retaining deeper detail.
5. Respect Source differences. Normalize enough for comparison without erasing meaningful differences in telemetry or workflow structure.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Maintain keyboard-readable document structure, visible focus states for interactive controls, text and data contrast that meets AA thresholds in both themes, redundant cues beyond color, color-blind-safe category distinctions, responsive layouts, automatic browser theme detection, and reduced-motion alternatives.
