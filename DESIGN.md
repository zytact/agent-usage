---
name: Agent Usage
description: A calm, precise usage dossier for local coding-agent activity.
colors:
  signal-coral: "oklch(0.68 0.21 24)"
  signal-coral-soft: "oklch(0.74 0.14 24)"
  focus-crimson: "oklch(0.72 0.16 5)"
  cache-cyan: "oklch(0.76 0.12 205)"
  output-gold: "oklch(0.79 0.14 82)"
  void: "oklch(0.085 0.003 265)"
  canvas: "oklch(0.105 0.004 265)"
  surface: "oklch(0.14 0.005 265)"
  surface-raised: "oklch(0.18 0.006 265)"
  divider: "oklch(0.31 0.009 265)"
  ink: "oklch(0.96 0.006 24)"
  muted: "oklch(0.73 0.008 265)"
  soft: "oklch(0.59 0.01 265)"
  light-void: "oklch(0.955 0.004 265)"
  light-canvas: "oklch(0.982 0.003 265)"
  light-surface: "oklch(0.995 0.002 265)"
  light-surface-raised: "oklch(0.935 0.006 265)"
  light-divider: "oklch(0.70 0.012 265)"
  light-ink: "oklch(0.205 0.012 265)"
  light-muted: "oklch(0.405 0.018 265)"
  light-soft: "oklch(0.47 0.022 265)"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 450
    lineHeight: 1.55
  label:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    lineHeight: 1.35
rounded:
  control: "0"
  surface: "0"
  feature: "0"
  track: "0"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  dossier-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.feature}"
    padding: "32px"
  metric-strip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "18px 20px"
  data-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  data-track:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.signal-coral}"
    rounded: "{rounded.track}"
    height: "7px"
---

# Design System: Agent Usage

## Overview

**Creative North Star: "Precision Observatory"**

The usage dossier should feel like a carefully tuned instrument viewed in a quiet workspace. Neutral foundations adapt to the browser's light or dark preference while the restrained coral signal color creates moments of energy and orientation. The composition combines Raycast's confidence and atmospheric depth with DeepSWE's sharp, editorial structure.

Information remains dense, but never cramped. Large totals establish the overall shape, compact labels support comparison, and layered surfaces group related data without turning every value into a floating card. The system explicitly rejects terminal-themed dashboards, generic SaaS analytics grids, decorative glassmorphism, and dense monitoring-console aesthetics.

**Key Characteristics:**

- Precise numerical hierarchy with tabular figures
- Adaptive neutral layers with one scarce coral signal color
- Sharp, continuous surfaces organized by thin editorial rules
- Compact analytical density with generous section rhythm
- State motion only, with reduced-motion parity

## Colors

The palette is restrained and neutral in both light and dark modes, with coral used as a deliberate signal and supporting data hues reserved for categorical distinction. Structural surfaces must not carry a visible red tint. The standalone report declares support for both color schemes and uses `prefers-color-scheme: light` to select its light tokens, leaving dark as the default fallback.

### Primary

- **Signal Coral:** The product signature, used for primary chart marks, current emphasis, and small orientation cues.
- **Soft Signal Coral:** A quieter companion for secondary chart marks and tinted information surfaces.

### Secondary

- **Focus Crimson:** Input and reasoning data, plus visible keyboard focus where interactive controls exist.
- **Cache Cyan:** Cached-token data and cache-related categorical marks.
- **Output Gold:** Output-token data and attention values that require a distinct non-error hue.

### Dark Neutral

- **Void:** The outermost browser background.
- **Canvas:** The report canvas and atmospheric backdrop.
- **Surface:** Primary grouped content regions.
- **Raised Surface:** Nested analytical regions and table headers.
- **Divider:** Structural separators and quiet outlines.
- **Ink:** Primary text and important values.
- **Muted:** Supporting labels and explanatory text.
- **Soft:** Tertiary metadata that remains legible at AA contrast.

### Light Neutral

- **Light Void:** The light outer browser background.
- **Light Canvas:** The near-white report backdrop.
- **Light Surface:** Primary grouped content regions.
- **Light Raised Surface:** Nested analytical regions and table headers.
- **Light Divider:** Structural separators that remain visible without dominating.
- **Light Ink:** Primary text and important values.
- **Light Muted:** Supporting labels and explanatory text.
- **Light Soft:** Tertiary metadata that remains legible at AA contrast.

### Named Rules

**The Signal Rarity Rule.** Signal Coral should occupy less than 10% of the visible surface. Its scarcity gives it meaning.

**The Adaptive Foundation Rule.** Canvas, surfaces, dividers, and neutral text use a coordinated near-black or near-white ramp chosen from the browser preference. Red never tints the entire interface.

**The Browser Preference Rule.** Theme selection follows `prefers-color-scheme`. Do not add a JavaScript theme bootstrap or persist a separate setting unless the product later introduces an explicit user control.

**The Data Owns Color Rule.** Supporting hues distinguish data categories. They do not decorate headings, containers, or prose.

## Typography

**Display Font:** Inter (with the native system sans stack)
**Body Font:** Inter (with the native system sans stack)
**Label/Mono Font:** The same sans family with tabular numeral features for data

**Character:** One disciplined sans family keeps the standalone report fast and self-contained. Weight, size, spacing, and tabular numerals create hierarchy without a decorative display face.

### Hierarchy

- **Display** (650, 2.75rem, 1.02): The dossier title only.
- **Headline** (650, 1.5rem, 1.15): Source names and major analytical sections.
- **Title** (650, 1rem, 1.35): Panel and visualization titles.
- **Body** (450, 0.9375rem, 1.55): Explanatory content, capped at 72ch where prose is continuous.
- **Label** (600, 0.78rem, 1.35): Metric labels, table headers, and metadata. Sentence case is mandatory.

### Geometry

Structural UI uses square corners. Panels, controls, tables, metric cells, tracks, disclosure rows, and inline code all use a zero radius. Circles are reserved for genuinely radial data visualizations and small status indicators.

### Named Rules

**The Numerical Cadence Rule.** Every comparable numeric value uses tabular figures and a consistent unit treatment.

**The One Family Rule.** Do not introduce a display face or monospace styling to manufacture technical character.

## Elevation

The system uses tonal layering as its primary depth mechanism. In both themes, surfaces are separated through lightness, restrained outlines, and local atmospheric color. Shadows are absent from ordinary containers and reserved for transient interactive overlays if those are introduced later.

### Named Rules

**The Layer Before Lift Rule.** Use tonal separation before shadow. A static report section never floats above the canvas.

## Components

### Dossier Header

- **Shape:** A composed feature surface with square corners.
- **Background:** A neutral-black surface with a small localized coral atmosphere, never a red wash or glass blur.
- **Structure:** Title and purpose on the left, compact report context on the right. Context cells share one continuous container.
- **Responsive treatment:** Collapse to one column and keep context in a two-column strip on narrow screens.

### Metric Strip

- **Shape:** One continuous square-cornered grouped surface, not four detached cards.
- **Dividers:** Quiet one-pixel separators create scanning lanes.
- **Values:** Large tabular figures with muted labels and tertiary notes.
- **Responsive treatment:** Two columns on medium screens and one column on narrow screens.

### Cards / Containers

- **Corner Style:** Square. Structural containers use zero corner radius.
- **Background:** Surface for major regions and Raised Surface for nested analytical content.
- **Shadow Strategy:** None at rest. Follow the Layer Before Lift Rule.
- **Border:** One quiet divider outline is allowed only when it defines a major region.
- **Internal Padding:** 16px for dense units, 24px for major sections, and 32px for the dossier header.

### Data Tracks

- **Style:** Square tracks at 6px to 8px high, with categorical fills and a visible minimum value.
- **State:** Color is always paired with a nearby text label and value.

### Tables

- **Style:** Open rows with horizontal separators, a Raised Surface header, and tabular numeric columns.
- **Density:** Standard rows use 10px vertical padding; dense diagnostic rows use 8px.
- **Responsive treatment:** Tables remain semantically intact and gain horizontal scrolling when columns cannot collapse safely.

### Disclosure Rows

- **Style:** Native details and summary elements with a generous focus target and a clear hover or focus-visible surface shift.
- **Motion:** State feedback lasts 180ms and becomes instant under reduced-motion preferences.

## Do's and Don'ts

### Do:

- **Do** use Signal Coral sparingly for primary chart marks and orientation cues.
- **Do** group related metrics into continuous surfaces with quiet dividers.
- **Do** preserve tabular figures, explicit units, and text labels alongside every color encoding.
- **Do** use square corners consistently across structural UI.
- **Do** maintain WCAG 2.2 AA contrast in both themes and reduced-motion behavior.
- **Do** let the browser preference choose the initial and active theme.

### Don't:

- **Don't** create terminal-themed dashboards with sharp neon-on-black styling, faux command prompts, scan lines, or hacker aesthetics.
- **Don't** build generic SaaS analytics pages from repeated floating cards and oversized vanity metrics.
- **Don't** use decorative glassmorphism, gratuitous gradients, or motion that competes with the data.
- **Don't** reproduce dense monitoring consoles that users must decode before reading their own activity.
- **Don't** round panels, controls, tables, metric cells, tracks, or disclosure rows.
- **Don't** use color as the only way to distinguish a data category.
- **Don't** assume a dark viewing environment or use JavaScript when the CSS preference query is sufficient.
