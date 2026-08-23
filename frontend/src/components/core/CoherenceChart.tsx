import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { ALARM_ACCENT, COHERENCE_ACCENT, PANEL_SURFACE, color } from '../../tokens'
import type { CoherenceThresholds, CoherenceVerdict } from './CoherenceGauge'

/**
 * CoherenceChart — coherence over the run, plotted against the gates that judge it.
 *
 * The dial answers "what is C now". This answers the question the demo is actually about: how far
 * past the line did it go, when, and what did the supervisor throw away to get back. Those are
 * time-series questions, so the time series is the hero and the dial is a readout beside it.
 *
 * The two calibrated gates (breach 0.608, warn 0.658) are drawn, not implied. A number without its
 * threshold on screen is a number the room has to take on trust.
 *
 * x is `seq`, the same axis TimelineTrack uses, so a beat lines up vertically across both.
 */

export type ChartPoint = {
  seq: number
  coherence: number
  verdict: CoherenceVerdict
}

export type CoherenceChartProps = {
  points: readonly ChartPoint[]
  thresholds: CoherenceThresholds
  /** Full seq extent of the run, so the plot shares the timeline's axis rather than its own. */
  domain: [number, number]
  /** Seq range discarded by a rollback, drawn as a struck-out region. */
  discarded?: readonly [number, number][]
  /** Seq at which corruption entered. */
  injections?: readonly number[]
  selectedSeq?: number | null
  onSelect?: (point: ChartPoint) => void
  height?: number
}

const PAD = { top: 20, right: 92, bottom: 26, left: 40 }
/** Where the y axis is labelled. The two gates carry their own labels on the right. */
const Y_TICKS = [0, 0.5, 1]
/** Minimum vertical separation between two gate labels before they start to collide. */
const LABEL_GAP = 15

const ZONE_COLOR: Readonly<Record<CoherenceVerdict, string>> = {
  pass: COHERENCE_ACCENT,
  warn: color.state.warn,
  breach: ALARM_ACCENT,
}

function useMeasuredWidth<T extends HTMLElement>(ref: React.RefObject<T | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setWidth(el.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function CoherenceChart({
  points,
  thresholds,
  domain,
  discarded = [],
  injections = [],
  selectedSeq = null,
  onSelect,
  height = 216,
}: CoherenceChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const measured = useMeasuredWidth(hostRef)
  // jsdom and a display:none ancestor both measure 0. Fall back to a sane stage width rather than
  // collapsing the plot to nothing.
  const width = measured || 900

  const plotW = Math.max(80, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom

  const [d0, d1] = domain
  const span = Math.max(1, d1 - d0)
  const x = useCallback(
    (seq: number) => PAD.left + ((seq - d0) / span) * plotW,
    [d0, span, plotW],
  )
  const y = useCallback((v: number) => PAD.top + (1 - Math.min(1, Math.max(0, v))) * plotH, [plotH])

  const yWarn = y(thresholds.warn)
  const yBreach = y(thresholds.breach)

  // The two gates sit 0.05 apart, which is ~8px on this plot. Push their labels apart and run a
  // leader back to the line each one names.
  const crowded = yBreach - yWarn < LABEL_GAP
  const labelWarn = crowded ? yWarn - (LABEL_GAP - (yBreach - yWarn)) / 2 : yWarn
  const labelBreach = crowded ? yBreach + (LABEL_GAP - (yBreach - yWarn)) / 2 : yBreach

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.seq)} ${y(p.coherence)}`).join(' ')

  return (
    <div ref={hostRef} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Coherence across ${points.length} verification windows, against a breach gate of ${thresholds.breach} and a warn gate of ${thresholds.warn}`}
      >
        {/* Zones. Below the breach gate is a place on this chart, not just a number. Held back
            until a window has actually closed: an empty plot washed in alarm is the first thing a
            cold page shows, and nothing has gone wrong yet. */}
        {points.length ? (
          <>
            <rect x={PAD.left} y={yBreach} width={plotW} height={PAD.top + plotH - yBreach} fill={ALARM_ACCENT} opacity={0.04} />
            <rect x={PAD.left} y={yWarn} width={plotW} height={yBreach - yWarn} fill={color.state.warn} opacity={0.14} />
          </>
        ) : null}

        {/* y axis. Three labels only: the two gates already carry numbers of their own. */}
        <g className="font-mono tabular-nums" fontSize={11}>
          {Y_TICKS.map((t) => (
            <g key={`y-${t}`}>
              {t > 0 ? (
                <line
                  x1={PAD.left}
                  y1={y(t)}
                  x2={PAD.left + plotW}
                  y2={y(t)}
                  stroke={color.edge.subtle}
                  strokeWidth={1}
                />
              ) : null}
              <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fill={color.ink.muted}>
                {t.toFixed(2)}
              </text>
            </g>
          ))}
        </g>

        {/* Discarded range: what the rollback threw away, struck out in place. */}
        {discarded.map(([from, to]) => (
          <g key={`disc-${from}-${to}`}>
            <rect
              x={x(from)}
              y={PAD.top}
              width={Math.max(1, x(to) - x(from))}
              height={plotH}
              fill={color.base[950]}
              opacity={0.62}
            />
            <line x1={x(from)} y1={PAD.top} x2={x(from)} y2={PAD.top + plotH} stroke={ALARM_ACCENT} strokeWidth={1} strokeDasharray="3 3" opacity={0.65} />
            <line x1={x(to)} y1={PAD.top} x2={x(to)} y2={PAD.top + plotH} stroke={ALARM_ACCENT} strokeWidth={1} strokeDasharray="3 3" opacity={0.65} />
            <text
              x={(x(from) + x(to)) / 2}
              y={PAD.top - 7}
              textAnchor="middle"
              fill={color.ink.muted}
              className="font-mono"
              fontSize={11}
              letterSpacing="0.14em"
            >
              discarded
            </text>
          </g>
        ))}

        {/* Gates. */}
        <line x1={PAD.left} y1={yWarn} x2={PAD.left + plotW} y2={yWarn} stroke={color.state.warn} strokeWidth={1} strokeDasharray="4 4" opacity={0.85} />
        <line x1={PAD.left} y1={yBreach} x2={PAD.left + plotW} y2={yBreach} stroke={ALARM_ACCENT} strokeWidth={1.5} opacity={0.9} />

        {/* Gate labels, in the right gutter, with a leader back to the line. */}
        <g className="font-mono" fontSize={11}>
          <path d={`M ${PAD.left + plotW} ${yWarn} L ${PAD.left + plotW + 8} ${labelWarn}`} stroke={color.state.warn} strokeWidth={1} fill="none" opacity={0.6} />
          <text x={PAD.left + plotW + 12} y={labelWarn + 3.5} fill={color.state.warn}>
            warn {thresholds.warn.toFixed(3)}
          </text>
          <path d={`M ${PAD.left + plotW} ${yBreach} L ${PAD.left + plotW + 8} ${labelBreach}`} stroke={ALARM_ACCENT} strokeWidth={1} fill="none" opacity={0.6} />
          <text x={PAD.left + plotW + 12} y={labelBreach + 3.5} fill={ALARM_ACCENT}>
            breach {thresholds.breach.toFixed(3)}
          </text>
        </g>

        {/* Injection: the moment the run was attacked. */}
        {injections.map((seq) => (
          <g key={`inj-${seq}`}>
            <line x1={x(seq)} y1={PAD.top} x2={x(seq)} y2={PAD.top + plotH} stroke={color.state.warn} strokeWidth={1.5} strokeDasharray="2 5" opacity={0.8} />
            <text x={x(seq) + 5} y={PAD.top + 10} className="font-mono" fontSize={11} fill={color.state.warn}>
              injection
            </text>
          </g>
        ))}

        {/* Selected window marker. */}
        {selectedSeq !== null ? (
          <line x1={x(selectedSeq)} y1={PAD.top - 4} x2={x(selectedSeq)} y2={PAD.top + plotH + 4} stroke={color.ink.primary} strokeWidth={1} opacity={0.5} />
        ) : null}

        <line
          x1={PAD.left}
          y1={PAD.top + plotH}
          x2={PAD.left + plotW}
          y2={PAD.top + plotH}
          stroke={color.edge.default}
          strokeWidth={2}
        />

        {points.length >= 2 ? (
          <path d={line} fill="none" stroke={color.coherence[500]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}

        {points.map((p) => {
          const isSelected = selectedSeq === p.seq
          const r = p.verdict === 'breach' ? 6 : 4.5
          return (
            <g key={p.seq}>
              {isSelected ? (
                <circle cx={x(p.seq)} cy={y(p.coherence)} r={r + 4} fill="none" stroke={color.ink.primary} strokeWidth={1.5} />
              ) : null}
              <circle
                cx={x(p.seq)}
                cy={y(p.coherence)}
                r={r}
                fill={ZONE_COLOR[p.verdict]}
                stroke={PANEL_SURFACE}
                strokeWidth={2}
              />
              <circle
                cx={x(p.seq)}
                cy={y(p.coherence)}
                r={14}
                fill="transparent"
                className={onSelect ? 'cursor-pointer' : undefined}
                onClick={onSelect ? () => onSelect(p) : undefined}
              >
                <title>{`seq ${p.seq} · C ${p.coherence.toFixed(3)} · ${p.verdict}`}</title>
              </circle>
              <text
                x={x(p.seq)}
                y={PAD.top + plotH + 16}
                textAnchor="middle"
                className="font-mono tabular-nums"
                fontSize={11}
                fill={isSelected ? color.ink.primary : color.ink.muted}
              >
                {p.seq}
              </text>
            </g>
          )
        })}

        {points.length === 0 ? (
          <text
            x={PAD.left + plotW / 2}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            className="font-mono"
            fontSize={11}
            letterSpacing="0.18em"
            fill={color.ink.muted}
          >
            AWAITING FIRST WINDOW
          </text>
        ) : null}
      </svg>
    </div>
  )
}
