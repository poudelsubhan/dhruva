/**
 * Dhruva design tokens — the canonical source of truth for the visual contract.
 *
 * WHY THIS FILE EXISTS IN JS: D3 and inline SVG need raw values at runtime.
 * `src/index.css`'s `@theme` block mirrors every token below as a CSS custom
 * property so Tailwind utilities exist for the same values.
 *
 * THESE TWO MUST NOT DRIFT. `src/tokens.test.ts` parses index.css, extracts the
 * `@theme` custom properties, and asserts an exact bidirectional match against
 * `themeVars` below. Add a token here and the test fails until index.css agrees.
 *
 * ── Design direction: instrument panel ──────────────────────────────────────
 * Near-black chassis, high-contrast type, and exactly two reserved hues:
 *
 *   coherence (cyan #35dcf2) — appears NOWHERE else in the UI. When coherence
 *                              moves, it is the only cyan on screen.
 *   alarm     (red  #f54123) — breach and rollback ONLY. Nothing else is red.
 *
 * Everything else is achromatic graphite/bone. Event identity is carried by
 * SHAPE (17 distinct glyphs), never by hue — 17 categories exceed any safe
 * categorical palette, and spending hue on them would drown the two signals
 * that matter.
 *
 * ── Palette validation (dataviz skill, scripts/validate_palette.js) ─────────
 * The four peer marks that can sit side by side — coherence-400, state-pass,
 * state-warn, alarm-400 — were selected by exhaustive OKLCH search, not by eye,
 * and validated `--mode dark --surface #12151c --pairs all`:
 *
 *   CVD separation       PASS  worst all-pairs ΔE 12.9 (deutan)   target >= 8
 *   Normal-vision floor  PASS  worst all-pairs ΔE 23.3            floor  >= 15
 *   Contrast vs surface  PASS  all four >= 4.9:1                  floor  >= 3:1
 *
 * Both ramps validated `--ordinal`: monotone lightness, every adjacent gap
 * >= 0.06 ΔL, single hue (spread <= 2 degrees), light end clears 2:1.
 *
 * Two deliberate, recorded deviations from the skill's default gates:
 *
 *  1. LIGHTNESS BAND — coherence-400 (L 0.823) and state-warn (L 0.821) sit
 *     above the dark band's 0.67 ceiling. That band is calibrated to surface
 *     #1a1a19; this chassis is #12151c, materially darker, and the deliverable
 *     is a projected demo in a bright room. Marks at the band ceiling measure
 *     ~5:1 here; these measure 11.0:1 and 10.3:1. Every other gate passes at
 *     the higher lightness.
 *
 *  2. CHROMA FLOOR — state-pass (C 0.03) is below the 0.10 floor and "reads
 *     gray". That is the intent: on an instrument panel a passing check is the
 *     quiet state and must not compete with the two reserved hues. It carries
 *     no hue-identity work. Its one close neighbour is ink-muted (ΔE 4.8), and
 *     that pair is resolved structurally, not chromatically: ink-muted is only
 *     ever <=13px metadata and axis ticks, while state-pass only ever appears
 *     on a verdict chip that carries a check glyph and the literal word PASS —
 *     the skill's own mitigation for status color (icon + label, never color
 *     alone). No other token pair falls below the ΔE 15 peer-mark floor.
 */

/* ── Color ─────────────────────────────────────────────────────────────────
 * base   — the chassis. 800 is the panel/chart surface everything validates against.
 * edge   — borders. Chrome only; never carries meaning.
 * ink    — type. Never wears a data color (dataviz rule); identity comes from
 *          the colored mark beside the text.
 * coherence — RESERVED. Gauge arc, sparkline, decay curve. 400 is the accent.
 * alarm     — RESERVED. Breach and rollback. 400 is the accent.
 * state     — muted verdict colors. pass recedes; warn steps forward.
 */
export const color = {
  base: {
    950: '#07080b',
    900: '#0b0d12',
    800: '#12151c',
    700: '#1a1e27',
    600: '#252a35',
    500: '#333947',
  },
  edge: {
    subtle: '#1e2330',
    default: '#2d3445',
    strong: '#4a556b',
  },
  ink: {
    primary: '#f2f5fa',
    secondary: '#b3b6bb',
    muted: '#7f8a9c',
    inverse: '#07080b',
  },
  coherence: {
    200: '#c9f6fe',
    300: '#7eecfd',
    400: '#35dcf2',
    500: '#2cc1d4',
    600: '#23a4b5',
    700: '#1a8896',
    800: '#106a75',
  },
  alarm: {
    200: '#fdcabf',
    300: '#fa8f7a',
    400: '#f54123',
    500: '#c92c11',
    600: '#9e1f08',
  },
  state: {
    pass: '#788c7f',
    warn: '#f9b73f',
  },
} as const

/* ── Type scale ────────────────────────────────────────────────────────────
 * Reads from 30 feet: heavy weight contrast, large numerics, nothing under 11px.
 */
export const type = {
  micro: '0.6875rem',
  caption: '0.8125rem',
  body: '0.9375rem',
  lead: '1.125rem',
  title: '1.5rem',
  display: '2.25rem',
  readout: '3.5rem',
} as const

/* ── Font stacks ──────────────────────────────────────────────────────────
 * System sans everywhere, including the hero figure. No display or serif face.
 */
export const font = {
  sans: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace',
} as const

/* ── Spacing ──────────────────────────────────────────────────────────────
 * `hair` is the dataviz surface gap: 2px of surface separating touching marks.
 */
export const space = {
  hair: '0.125rem',
  tick: '0.25rem',
  tight: '0.5rem',
  snug: '0.75rem',
  gutter: '1rem',
  panel: '1.25rem',
  bay: '2rem',
  deck: '3rem',
} as const

/* ── Radii ────────────────────────────────────────────────────────────────
 * `mark` is the dataviz 4px rounded data-end.
 */
export const radius = {
  tick: '0.125rem',
  mark: '0.25rem',
  control: '0.375rem',
  panel: '0.625rem',
  pill: '9999px',
} as const

/* ── Motion ───────────────────────────────────────────────────────────────
 * Motion means one thing here: a stream pulse when an event arrives. Nothing
 * decorative. `gauge` and `arc` are value tweens, not entrances.
 */
export const motion = {
  instant: '90ms',
  pulse: '420ms',
  gauge: '620ms',
  arc: '900ms',
} as const

export const easing = {
  instrument: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const

/* ── Layering ─────────────────────────────────────────────────────────────── */
export const layer = {
  track: 10,
  arc: 20,
  playhead: 30,
  tooltip: 60,
  overlay: 80,
} as const

/* ── Derived, for JS/D3 consumers ─────────────────────────────────────────── */

/** The one hue reserved for coherence. Never use it for anything else. */
export const COHERENCE_ACCENT = color.coherence[400]

/** The one hue reserved for breach and rollback. Never use it for anything else. */
export const ALARM_ACCENT = color.alarm[400]

/** The surface every mark in this system is contrast-validated against. */
export const PANEL_SURFACE = color.base[800]

export type MotionKey = keyof typeof motion

/** Numeric duration for rAF tweens, parsed from the same string the CSS uses. */
export function durationMs(key: MotionKey): number {
  return Number.parseInt(motion[key], 10)
}

/* ── The mirror ───────────────────────────────────────────────────────────
 * Every token above, flattened to the exact CSS custom property name that
 * index.css's `@theme` block must declare. tokens.test.ts asserts equality in
 * both directions, so neither file can grow a token the other lacks.
 */
function flatten(
  prefix: string,
  group: Readonly<Record<string, string | number>>,
  out: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(group)) {
    out[`${prefix}${key}`] = String(value)
  }
}

function buildThemeVars(): Record<string, string> {
  const out: Record<string, string> = {}
  const colorGroups = color as unknown as Readonly<Record<string, Record<string, string>>>
  for (const [groupName, group] of Object.entries(colorGroups)) {
    flatten(`--color-${groupName}-`, group, out)
  }
  flatten('--text-', type, out)
  flatten('--font-', font, out)
  flatten('--spacing-', space, out)
  flatten('--radius-', radius, out)
  flatten('--motion-', motion, out)
  flatten('--ease-', easing, out)
  flatten('--z-', layer, out)
  return out
}

/** CSS custom property name -> value, for every token in this file. */
export const themeVars: Readonly<Record<string, string>> = Object.freeze(buildThemeVars())
