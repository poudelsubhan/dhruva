import type { ReactNode } from 'react'

import clsx from 'clsx'

/**
 * EventGlyph — one distinct glyph per RunEvent type, all 17.
 *
 * SHAPE IS THE PRIMARY CHANNEL, NOT COLOR. Two reasons:
 *   1. 17 categories is far past what any colorblind-safe categorical palette
 *      carries (the dataviz gate caps a validated palette well below that, and
 *      a generated 9th hue is never the answer).
 *   2. This system reserves its only two hues — coherence cyan and alarm red —
 *      for coherence and for breach/rollback. Spending hue on event identity
 *      would drown both.
 *
 * So every glyph is drawn achromatic (ink-secondary) except breach and
 * rollback, which are the reserved alarm red. Consumers tint verification
 * glyphs by verdict through `className`.
 *
 * Legibility contract: each glyph is drawn on a 24x24 viewBox with a constant
 * 2.75-unit stroke, which renders ~1.8px at size 16 and ~2.3px at size 20 —
 * never a hairline. Silhouettes were chosen to stay separable in a dense row of
 * 200: no two glyphs share an outline family and orientation.
 */

export const EVENT_TYPES = [
  // Core lifecycle + agent loop
  'task_start',
  'action',
  'observation',
  'memory_op',
  'verification',
  'checkpoint',
  'breach',
  'rollback',
  'resume',
  'injection',
  'task_complete',
  // Knowledge tier
  'learning',
  'ledger_audit',
  // Swarm tier
  'swarm_checkpoint',
  'swarm_verification',
  'bulletin',
  'quarantine',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type EventGlyphProps = {
  /** Which of the 17 frozen event types to draw. */
  type: EventType
  /** Rendered edge length in px. Legible down to 16. Defaults to 20. */
  size?: number
  /** Fixture ground-truth contamination. Adds a strike-through and warn tint. */
  poisoned?: boolean
  className?: string
}

/** Human-readable label — the identity channel that is never color-alone. */
export const EVENT_LABELS: Readonly<Record<EventType, string>> = {
  task_start: 'Task start',
  action: 'Action',
  observation: 'Observation',
  memory_op: 'Memory op',
  verification: 'Verification',
  checkpoint: 'Checkpoint',
  breach: 'Breach',
  rollback: 'Rollback',
  resume: 'Resume',
  injection: 'Injection',
  task_complete: 'Task complete',
  learning: 'Learning admitted',
  ledger_audit: 'Ledger audit',
  swarm_checkpoint: 'Swarm checkpoint',
  swarm_verification: 'Swarm verification',
  bulletin: 'Bulletin',
  quarantine: 'Quarantine',
}

/** One-line description of the drawn silhouette — the visual contract, in words. */
export const EVENT_GLYPH_SHAPES: Readonly<Record<EventType, string>> = {
  task_start: 'filled play triangle, pointing right',
  action: 'filled vertical tick bar',
  observation: 'hollow ring',
  memory_op: 'three stacked horizontal bars',
  verification: 'bold checkmark',
  checkpoint: 'diamond outline',
  breach: 'filled warning triangle, exclamation knocked out',
  rollback: 'U-turn arrow curving back to the left',
  resume: 'double chevron, pointing right',
  injection: 'down arrow striking a baseline',
  task_complete: 'pennant flag on a pole',
  learning: 'filled four-point spark',
  ledger_audit: 'split box, left half solid (retained), right half empty (evicted)',
  swarm_checkpoint: 'two narrow diamonds side by side',
  swarm_verification: 'double checkmark',
  bulletin: 'broadcast dot with radiating arcs',
  quarantine: 'containment brackets around a filled square',
}

const STROKE = 2.75

/** Shared stroke setup for outline glyphs. */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: STROKE,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const F = { fill: 'currentColor' } as const

const GLYPHS: Readonly<Record<EventType, ReactNode>> = {
  task_start: <path {...F} d="M7 4 L20 12 L7 20 Z" />,

  action: <rect {...F} x="9.4" y="3.4" width="5.2" height="17.2" rx="2.6" />,

  observation: <circle {...S} cx="12" cy="12" r="7.4" />,

  memory_op: (
    <g {...F}>
      <rect x="3.4" y="5" width="17.2" height="3.2" rx="1.6" />
      <rect x="3.4" y="10.4" width="17.2" height="3.2" rx="1.6" />
      <rect x="3.4" y="15.8" width="11" height="3.2" rx="1.6" />
    </g>
  ),

  verification: <path {...S} d="M3.8 12.6 L9.6 18.4 L20.2 5.8" />,

  checkpoint: <path {...S} d="M12 3 L21 12 L12 21 L3 12 Z" />,

  breach: (
    <path
      {...F}
      fillRule="evenodd"
      d="M12 2.4 L22.8 21.2 H1.2 Z M10.8 8.6 h2.4 v6.4 h-2.4 z M10.8 16.6 h2.4 v2.4 h-2.4 z"
    />
  ),

  rollback: (
    <g {...S}>
      <path d="M19.5 19 C19.5 10.4 15.6 6.6 6.4 6.6" />
      <path d="M10.8 2.4 L5.2 6.6 L10.8 10.8" />
    </g>
  ),

  resume: (
    <g {...S}>
      <path d="M5.6 5 L12.4 12 L5.6 19" />
      <path d="M13.4 5 L20.2 12 L13.4 19" />
    </g>
  ),

  injection: (
    <g {...S}>
      <path d="M12 2.4 V14.8" />
      <path d="M7.4 10.4 L12 15.2 L16.6 10.4" />
      <path d="M4 20 H20" />
    </g>
  ),

  task_complete: (
    <g>
      <path {...S} d="M6.2 3 V21.2" />
      <path {...F} d="M7.6 3.6 L20 7.8 L7.6 12 Z" />
    </g>
  ),

  learning: (
    <path
      {...F}
      d="M12 1.6 C13.3 8.1 15.9 10.7 22.4 12 C15.9 13.3 13.3 15.9 12 22.4 C10.7 15.9 8.1 13.3 1.6 12 C8.1 10.7 10.7 8.1 12 1.6 Z"
    />
  ),

  ledger_audit: (
    <g>
      <rect {...S} x="3.4" y="4.6" width="17.2" height="14.8" rx="2" />
      <path {...S} d="M12 4.6 V19.4" />
      <rect {...F} x="5.4" y="6.6" width="4.6" height="10.8" rx="1" />
    </g>
  ),

  swarm_checkpoint: (
    <g {...S}>
      <path d="M6.4 4.6 L11 12 L6.4 19.4 L1.8 12 Z" />
      <path d="M17.6 4.6 L22.2 12 L17.6 19.4 L13 12 Z" />
    </g>
  ),

  swarm_verification: (
    <g {...S}>
      <path d="M1.8 12.6 L6.6 17.4 L14.4 7.2" />
      <path d="M10.6 13.6 L13.4 16.6 L22.2 5.6" />
    </g>
  ),

  bulletin: (
    <g>
      <circle {...F} cx="5.2" cy="12" r="2.8" />
      <path {...S} d="M10.4 7.4 A 6.6 6.6 0 0 1 10.4 16.6" />
      <path {...S} d="M15.4 3.8 A 11.4 11.4 0 0 1 15.4 20.2" />
    </g>
  ),

  quarantine: (
    <g>
      <path {...S} d="M7 3.6 H3.2 V20.4 H7" />
      <path {...S} d="M17 3.6 H20.8 V20.4 H17" />
      <rect {...F} x="9" y="9" width="6" height="6" rx="1.2" />
    </g>
  ),
}

/**
 * Tone is semantic and deliberately near-monochrome. Alarm red is reserved for
 * exactly these two types and appears nowhere else in the system.
 */
const ALARM_TYPES: ReadonlySet<EventType> = new Set<EventType>(['breach', 'rollback'])

export function EventGlyph({ type, size = 20, poisoned = false, className }: EventGlyphProps) {
  const label = poisoned ? `${EVENT_LABELS[type]} (poisoned)` : EVENT_LABELS[type]

  const tone = poisoned
    ? 'text-state-warn'
    : ALARM_TYPES.has(type)
      ? 'text-alarm-400'
      : 'text-ink-secondary'

  return (
    <svg
      role="img"
      aria-label={label}
      data-event-type={type}
      data-poisoned={poisoned ? 'true' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={clsx('shrink-0', tone, className)}
    >
      <title>{label}</title>
      {GLYPHS[type]}
      {poisoned ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          d="M3.6 20.4 L20.4 3.6"
        />
      ) : null}
    </svg>
  )
}
