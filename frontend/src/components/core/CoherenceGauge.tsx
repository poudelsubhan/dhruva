import { useEffect, useRef, useState } from 'react'

import {
  ALARM_ACCENT,
  COHERENCE_ACCENT,
  PANEL_SURFACE,
  color,
  durationMs,
} from '../../tokens'

/**
 * CoherenceGauge — the one place the reserved coherence hue appears.
 *
 * This is the dataviz "stat tile + meter" form, built to its contract:
 *   label     the Panel title above it
 *   value     a hero figure, >= 48px at the default size
 *   delta     a verdict chip — status color ALWAYS paired with icon + label
 *   trend     a sparkline in the de-emphasis step, current point in the accent
 *
 * Meter rule: the fill carries severity (accent -> warning -> danger) and the
 * unfilled track is a darker step of the same ramp, so state reads across the
 * whole dial rather than only at the tip.
 *
 * The hero number stays in ink-primary rather than the zone color. Text never
 * wears a data color; and at 16.7:1 on this chassis bone white simply reads
 * further across a room than any chromatic step could. The arc and the chip
 * carry the color.
 */

export type CoherenceThresholds = {
  /** Below this, the verdict is `warn`. Default 0.70. */
  warn: number
  /** Below this, the verdict is `breach`. Default 0.55. */
  breach: number
}

export type CoherenceGaugeProps = {
  /** Composite coherence C, clamped to [0, 1]. */
  coherence: number
  thresholds?: CoherenceThresholds
  /** Dial diameter in px. At the default 200 the readout is exactly 56px. */
  size?: number
  /** Verification history, oldest first. Rendered as the trend sparkline. */
  sparkline?: number[]
}

export const DEFAULT_THRESHOLDS: CoherenceThresholds = { warn: 0.7, breach: 0.55 }

export type CoherenceVerdict = 'pass' | 'warn' | 'breach'

export function verdictFor(coherence: number, thresholds: CoherenceThresholds): CoherenceVerdict {
  if (coherence >= thresholds.warn) return 'pass'
  if (coherence >= thresholds.breach) return 'warn'
  return 'breach'
}

const ZONE_COLOR: Readonly<Record<CoherenceVerdict, string>> = {
  pass: COHERENCE_ACCENT,
  warn: color.state.warn,
  breach: ALARM_ACCENT,
}

const ZONE_LABEL: Readonly<Record<CoherenceVerdict, string>> = {
  pass: 'PASS',
  warn: 'WARN',
  breach: 'BREACH',
}

/* ── dial geometry ─────────────────────────────────────────────────────────
 * A 240-degree sweep opening at the bottom: t=0 sits at -120deg from twelve
 * o'clock, t=1 at +120deg. Angles are clockwise-from-up, which maps directly
 * onto SVG's y-down arc sweep flag.
 */
const START_ANGLE = -120
const SWEEP = 240

function pointOnDial(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function dialArc(cx: number, cy: number, r: number, t0: number, t1: number): string {
  const a0 = START_ANGLE + t0 * SWEEP
  const a1 = START_ANGLE + t1 * SWEEP
  const p0 = pointOnDial(cx, cy, r, a0)
  const p1 = pointOnDial(cx, cy, r, a1)
  const largeArc = a1 - a0 > 180 ? 1 : 0
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} 1 ${p1.x} ${p1.y}`
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Tween a scalar with rAF. Mounts at the target (so a first paint and any test
 * assertion see the real number immediately) and only animates on change.
 */
function useAnimatedNumber(target: number, duration: number): number {
  const [value, setValue] = useState(target)
  const currentRef = useRef(target)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const from = currentRef.current
    if (from === target) return

    if (duration <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      currentRef.current = target
      setValue(target)
      return
    }

    const startedAt = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - (1 - p) ** 3
      const next = from + (target - from) * eased
      currentRef.current = next
      setValue(next)
      if (p < 1) frameRef.current = requestAnimationFrame(tick)
      else {
        currentRef.current = target
        frameRef.current = null
      }
    }
    frameRef.current = requestAnimationFrame(tick)

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [target, duration])

  return value
}

function VerdictIcon({ verdict }: { verdict: CoherenceVerdict }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      {verdict === 'pass' ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 12.6 L9.6 18.4 L20 5.8"
        />
      ) : (
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M12 2.4 L22.8 21.2 H1.2 Z M10.8 8.6 h2.4 v6.4 h-2.4 z M10.8 16.6 h2.4 v2.4 h-2.4 z"
        />
      )}
    </svg>
  )
}

function Sparkline({ values, width, verdict }: { values: number[]; width: number; verdict: CoherenceVerdict }) {
  const height = Math.round(width * 0.26)
  const padX = 6
  const padY = 8
  const innerW = width - padX * 2
  const innerH = height - padY * 2

  const x = (i: number) => padX + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW)
  const y = (v: number) => padY + (1 - clamp01(v)) * innerH

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
  const lastIndex = values.length - 1
  const tail = `M ${x(lastIndex - 1)} ${y(values[lastIndex - 1])} L ${x(lastIndex)} ${y(values[lastIndex])}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Coherence trend over the last ${values.length} verification windows`}
      className="mt-tight"
    >
      {/* Recessive hairline chrome: the warn gate, so decay reads against it. */}
      <line
        x1={padX}
        y1={y(DEFAULT_THRESHOLDS.warn)}
        x2={width - padX}
        y2={y(DEFAULT_THRESHOLDS.warn)}
        stroke={color.edge.strong}
        strokeWidth={1}
      />
      <path d={line} fill="none" stroke={color.coherence[600]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d={tail} fill="none" stroke={COHERENCE_ACCENT} strokeWidth={2} strokeLinecap="round" />
      {/* End marker: >= 8px with a 2px surface ring so it stays legible on the line. */}
      <circle
        cx={x(lastIndex)}
        cy={y(values[lastIndex])}
        r={4}
        fill={ZONE_COLOR[verdict]}
        stroke={PANEL_SURFACE}
        strokeWidth={2}
      />
    </svg>
  )
}

export function CoherenceGauge({
  coherence,
  thresholds = DEFAULT_THRESHOLDS,
  size = 200,
  sparkline,
}: CoherenceGaugeProps) {
  const target = clamp01(coherence)
  const animated = useAnimatedNumber(target, durationMs('gauge'))

  // Verdict follows the settled value, not the tween, so a chip never flickers
  // through BREACH on the way up.
  const verdict = verdictFor(target, thresholds)
  const zone = ZONE_COLOR[verdict]

  const stroke = size * 0.085
  const tickOut = size * 0.055
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - stroke / 2 - tickOut

  const tip = pointOnDial(cx, cy, r, START_ANGLE + animated * SWEEP)
  const readoutPx = size * 0.28

  const marks: Array<{ t: number; stroke: string; label: string }> = [
    { t: thresholds.breach, stroke: ALARM_ACCENT, label: thresholds.breach.toFixed(2) },
    { t: thresholds.warn, stroke: color.state.warn, label: thresholds.warn.toFixed(2) },
  ]

  const trend = sparkline && sparkline.length >= 2 ? sparkline : null

  return (
    <div className="flex flex-col items-center" data-verdict={verdict}>
      <div className="relative" style={{ width: size, height: size * 0.82 }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Coherence ${target.toFixed(2)}, verdict ${ZONE_LABEL[verdict]}`}
          className="absolute top-0 left-0"
        >
          {/* Track: a darker step of the coherence ramp — state reads across the bar. */}
          <path
            d={dialArc(cx, cy, r, 0, 1)}
            fill="none"
            stroke={color.coherence[800]}
            strokeWidth={stroke}
            strokeLinecap="butt"
          />

          {/* Threshold gates, 3px radial ticks straddling the track. */}
          {marks.map((mark) => {
            const angle = START_ANGLE + mark.t * SWEEP
            const a = pointOnDial(cx, cy, r - stroke / 2 - 1, angle)
            const b = pointOnDial(cx, cy, r + stroke / 2 + tickOut * 0.62, angle)
            return (
              <g key={mark.label}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={mark.stroke} strokeWidth={3} strokeLinecap="round" />
              </g>
            )
          })}

          {/* Value arc: square at the baseline, rounded data-end at the tip. */}
          {animated > 0.001 ? (
            <>
              <path
                d={dialArc(cx, cy, r, 0, animated)}
                fill="none"
                stroke={zone}
                strokeWidth={stroke}
                strokeLinecap="butt"
              />
              <circle cx={tip.x} cy={tip.y} r={stroke / 2} fill={zone} />
            </>
          ) : null}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-tick pt-tight">
          <output
            className="font-semibold tracking-tight text-ink-primary tabular-nums"
            style={{ fontSize: readoutPx, lineHeight: 1 }}
          >
            {animated.toFixed(2)}
          </output>
          <span className="font-mono text-micro tracking-[0.2em] text-ink-muted uppercase">
            coherence
          </span>
        </div>
      </div>

      {/* Status is never color alone: icon + label, always. */}
      <div
        className="mt-tight inline-flex items-center gap-tight rounded-pill border-2 px-snug py-tick font-mono text-caption font-semibold tracking-[0.16em] uppercase"
        style={{ color: zone, borderColor: zone }}
      >
        <VerdictIcon verdict={verdict} />
        {ZONE_LABEL[verdict]}
      </div>

      {trend ? <Sparkline values={trend} width={size} verdict={verdict} /> : null}
    </div>
  )
}
