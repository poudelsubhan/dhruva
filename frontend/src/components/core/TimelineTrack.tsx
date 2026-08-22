import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import clsx from 'clsx'

import { ALARM_ACCENT, color } from '../../tokens'
import { EVENT_LABELS, EventGlyph, type EventType } from './EventGlyph'

/**
 * TimelineTrack — the flight recorder's spine: a horizontal seq axis carrying
 * one EventGlyph per event, plus rollback arcs, hover-to-inspect, and a pinned
 * playhead.
 *
 * VIRTUALIZATION. The track never squeezes glyphs together to fit: seq maps to
 * x at a floor of MIN_PX_PER_SEQ, and the container scrolls when the run is
 * longer than the viewport. Only the glyphs whose x falls inside the scrolled
 * viewport (plus an overscan margin) are mounted, found by binary search over
 * the seq-sorted list. A 500-event run is ~9000px of content with roughly 90
 * live nodes, and scrolling mounts a handful more.
 *
 * When the container has not been measured — SSR, jsdom, a display:none
 * ancestor — width reads 0 and the track renders every event rather than
 * silently rendering none.
 */

/** Structural minimum a RunEvent must satisfy to be drawn. */
export type TimelineEvent = {
  seq: number
  type: EventType
  ts?: string
  poisoned?: boolean
}

/** A rollback: a quadratic curve from the breach seq back to the target seq. */
export type TimelineArc = {
  fromSeq: number
  toSeq: number
  id?: string
  label?: string
}

export type TimelineTrackProps<E extends TimelineEvent = TimelineEvent> = {
  events: readonly E[]
  /** Explicit [minSeq, maxSeq]. Defaults to the extent of `events`. */
  domain?: [number, number]
  onSelect?: (event: E) => void
  arcs?: readonly TimelineArc[]
  /** Pins a vertical playhead at this seq. */
  playhead?: number | null
  /** Total track height in px. Defaults to 132. */
  height?: number
}

const MIN_PX_PER_SEQ = 18
const EDGE_PAD = 28
const HIT = 30
const OVERSCAN_PX = 240

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

/** First index whose seq is >= target, over a seq-ascending list. */
function lowerBound(events: readonly TimelineEvent[], target: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].seq < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function TimelineTrack<E extends TimelineEvent>({
  events,
  domain,
  onSelect,
  arcs,
  playhead = null,
  height = 132,
}: TimelineTrackProps<E>) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const width = useMeasuredWidth(scrollerRef)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [hovered, setHovered] = useState<E | null>(null)

  const sorted = useMemo(() => [...events].sort((a, b) => a.seq - b.seq), [events])

  const [d0, d1] = useMemo<[number, number]>(() => {
    if (domain) return domain
    if (sorted.length === 0) return [0, 1]
    return [sorted[0].seq, sorted[sorted.length - 1].seq]
  }, [domain, sorted])

  const span = Math.max(1, d1 - d0)
  const pxPerSeq = Math.max(MIN_PX_PER_SEQ, (width - EDGE_PAD * 2) / span)
  const contentWidth = span * pxPerSeq + EDGE_PAD * 2

  const x = useCallback((seq: number) => EDGE_PAD + (seq - d0) * pxPerSeq, [d0, pxPerSeq])

  // Stream pulse: anything past the highest seq we have already drawn is new.
  const maxSeq = sorted.length === 0 ? Number.NEGATIVE_INFINITY : sorted[sorted.length - 1].seq
  const drawnMaxRef = useRef<number>(Number.NEGATIVE_INFINITY)
  const pulseAbove = drawnMaxRef.current
  useEffect(() => {
    drawnMaxRef.current = maxSeq
  }, [maxSeq])

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(event.currentTarget.scrollLeft)
  }, [])

  // Unmeasured container -> render everything rather than nothing.
  const visible = useMemo(() => {
    if (width === 0) return sorted
    const fromSeq = d0 + (scrollLeft - OVERSCAN_PX - EDGE_PAD) / pxPerSeq
    const toSeq = d0 + (scrollLeft + width + OVERSCAN_PX - EDGE_PAD) / pxPerSeq
    return sorted.slice(lowerBound(sorted, fromSeq), lowerBound(sorted, toSeq + 1))
  }, [sorted, width, scrollLeft, d0, pxPerSeq])

  const baselineY = Math.round(height * 0.62)
  const arcApexY = Math.round(height * 0.14)

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="relative overflow-x-auto overflow-y-hidden"
        style={{ height }}
        data-testid="timeline-scroller"
      >
        <div className="relative" style={{ width: contentWidth, height }}>
          <svg
            width={contentWidth}
            height={height}
            className="absolute top-0 left-0"
            aria-hidden="true"
            style={{ zIndex: 'var(--z-track)' }}
          >
            {/* Baseline: 2px, not a hairline — it anchors every mark on the track. */}
            <line
              x1={EDGE_PAD * 0.5}
              y1={baselineY}
              x2={contentWidth - EDGE_PAD * 0.5}
              y2={baselineY}
              stroke={color.edge.strong}
              strokeWidth={2}
            />

            {/* Rollback arcs: quadratic curve from breach seq back to the target. */}
            {(arcs ?? []).map((arc) => {
              const xFrom = x(arc.fromSeq)
              const xTo = x(arc.toSeq)
              const apexX = (xFrom + xTo) / 2
              const top = baselineY - 26
              return (
                <g key={arc.id ?? `${arc.fromSeq}-${arc.toSeq}`} style={{ zIndex: 'var(--z-arc)' }}>
                  <path
                    d={`M ${xFrom} ${top} Q ${apexX} ${arcApexY} ${xTo} ${top}`}
                    fill="none"
                    stroke={ALARM_ACCENT}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  <path
                    d={`M ${xTo - 5} ${top - 7} L ${xTo} ${top + 1} L ${xTo + 5} ${top - 7} Z`}
                    fill={ALARM_ACCENT}
                  />
                  <circle cx={xFrom} cy={top} r={3} fill={ALARM_ACCENT} />
                </g>
              )
            })}

            {/* Playhead. */}
            {playhead !== null && playhead !== undefined ? (
              <g style={{ zIndex: 'var(--z-playhead)' }}>
                <line
                  x1={x(playhead)}
                  y1={arcApexY}
                  x2={x(playhead)}
                  y2={height - 4}
                  stroke={color.ink.primary}
                  strokeWidth={2}
                />
                <path
                  d={`M ${x(playhead) - 5} ${arcApexY} L ${x(playhead) + 5} ${arcApexY} L ${x(playhead)} ${arcApexY + 8} Z`}
                  fill={color.ink.primary}
                />
              </g>
            ) : null}
          </svg>

          {visible.map((event) => {
            const isNew = event.seq > pulseAbove
            const selectable = Boolean(onSelect)
            return (
              <button
                key={event.seq}
                type="button"
                disabled={!selectable}
                onClick={selectable ? () => onSelect?.(event) : undefined}
                onMouseEnter={() => setHovered(event)}
                onMouseLeave={() => setHovered((prev) => (prev === event ? null : prev))}
                onFocus={() => setHovered(event)}
                onBlur={() => setHovered((prev) => (prev === event ? null : prev))}
                title={`seq ${event.seq} · ${EVENT_LABELS[event.type]}`}
                data-seq={event.seq}
                className={clsx(
                  'absolute flex items-center justify-center rounded-mark',
                  selectable && 'cursor-pointer hover:bg-base-600',
                  isNew && 'stream-pulse',
                )}
                style={{
                  left: x(event.seq) - HIT / 2,
                  top: baselineY - HIT / 2,
                  width: HIT,
                  height: HIT,
                }}
              >
                <EventGlyph type={event.type} size={20} poisoned={event.poisoned} />
              </button>
            )
          })}

          {/* Seq ruler, muted and tabular — chrome, never a mark. */}
          {visible.map((event) =>
            event.seq % 5 === 0 ? (
              <span
                key={`tick-${event.seq}`}
                aria-hidden="true"
                className="absolute font-mono text-micro text-ink-muted tabular-nums"
                style={{ left: x(event.seq) - 12, top: baselineY + 22, width: 24, textAlign: 'center' }}
              >
                {event.seq}
              </span>
            ) : null,
          )}
        </div>
      </div>

      {hovered ? (
        <div
          role="status"
          className="pointer-events-none absolute -top-1 left-0 flex items-center gap-tight rounded-control border-2 border-edge-strong bg-base-950 px-snug py-tick font-mono text-caption text-ink-primary shadow-lg"
          style={{ zIndex: 'var(--z-tooltip)' }}
        >
          <EventGlyph type={hovered.type} size={16} poisoned={hovered.poisoned} />
          <span className="tabular-nums">seq {hovered.seq}</span>
          <span className="text-ink-muted">{EVENT_LABELS[hovered.type]}</span>
          {hovered.ts ? <span className="text-ink-muted">{hovered.ts.slice(11, 19)}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
