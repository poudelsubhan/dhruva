/**
 * Supervised vs unsupervised, on an identical task and injection schedule.
 *
 * The control arm is what turns "the supervisor did something" into evidence: both runs get the
 * same corruption at the same step, both compute coherence, and only one is allowed to intervene.
 * The gap between the curves is the intervention's effect, measured rather than asserted.
 *
 * Half-life is the first crossing of C = 0.5 on the unsupervised curve, linearly interpolated
 * between the two verifications that straddle it.
 */

import { useMemo } from 'react'
import clsx from 'clsx'
import { Panel, TimelineTrack, type TimelineEvent } from '../../components/core'
import type { DhruvaEvent } from '../../contracts'
import { coherenceHalfLife, derive, type CoherencePoint } from '../../data/derive'
import { color } from '../../tokens'

export interface TwinViewProps {
  supervised: readonly DhruvaEvent[]
  unsupervised: readonly DhruvaEvent[]
  supervisedLabel?: string
  unsupervisedLabel?: string
}

const W = 720
const H = 220
const PAD = { top: 16, right: 20, bottom: 28, left: 40 }

function useDomain(a: CoherencePoint[], b: CoherencePoint[]): [number, number] {
  return useMemo(() => {
    const seqs = [...a, ...b].map((p) => p.seq)
    return seqs.length ? [Math.min(...seqs), Math.max(...seqs)] : [0, 1]
  }, [a, b])
}

function path(points: CoherencePoint[], domain: [number, number]): string {
  const [lo, hi] = domain
  const span = Math.max(1, hi - lo)
  const x = (seq: number) => PAD.left + ((seq - lo) / span) * (W - PAD.left - PAD.right)
  const y = (c: number) => PAD.top + (1 - c) * (H - PAD.top - PAD.bottom)
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.seq).toFixed(1)},${y(p.coherence).toFixed(1)}`).join(' ')
}

export default function TwinView({
  supervised,
  unsupervised,
  supervisedLabel = 'supervised',
  unsupervisedLabel = 'unsupervised',
}: TwinViewProps) {
  const sup = useMemo(() => derive(supervised), [supervised])
  const uns = useMemo(() => derive(unsupervised), [unsupervised])
  const domain = useDomain(sup.coherence, uns.coherence)

  const halfLife = coherenceHalfLife(uns.coherence)
  const supHalfLife = coherenceHalfLife(sup.coherence)

  const [lo, hi] = domain
  const span = Math.max(1, hi - lo)
  const x = (seq: number) => PAD.left + ((seq - lo) / span) * (W - PAD.left - PAD.right)
  const y = (c: number) => PAD.top + (1 - c) * (H - PAD.top - PAD.bottom)

  const toTimeline = (events: readonly DhruvaEvent[]): TimelineEvent[] =>
    events.map((e) => ({
      seq: e.seq,
      type: e.type,
      ts: e.ts,
      poisoned: e.type === 'observation' && Boolean((e.payload as { poisoned?: boolean }).poisoned),
    }))

  return (
    <div className="flex flex-col gap-gutter">
      <Panel
        title="coherence decay · supervised vs unsupervised"
        status={
          <span className="font-mono text-micro">
            {halfLife === null ? (
              <span className="text-ink-muted">no half-life — never crossed 0.5</span>
            ) : (
              <span className="text-alarm-400">unsupervised half-life · seq {halfLife.toFixed(1)}</span>
            )}
          </span>
        }
      >
        <div className="overflow-x-auto p-panel">
          <svg width={W} height={H} role="img" aria-label="coherence decay curves" className="max-w-full">
            {[0, 0.5, 1].map((level) => (
              <g key={level}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(level)}
                  y2={y(level)}
                  stroke={color.edge.subtle}
                  strokeDasharray={level === 0.5 ? '4 4' : undefined}
                />
                <text x={4} y={y(level) + 4} className="font-mono" fontSize="10" fill={color.ink.muted}>
                  {level.toFixed(1)}
                </text>
              </g>
            ))}

            {uns.coherence.length > 1 ? (
              <path d={path(uns.coherence, domain)} fill="none" stroke={color.alarm[400]} strokeWidth={2} />
            ) : null}
            {sup.coherence.length > 1 ? (
              <path d={path(sup.coherence, domain)} fill="none" stroke={color.coherence[400]} strokeWidth={2} />
            ) : null}

            {sup.arcs.map((arc) => (
              <line
                key={arc.id}
                x1={x(arc.fromSeq)}
                x2={x(arc.fromSeq)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke={color.coherence[400]}
                strokeDasharray="3 3"
                opacity={0.6}
              />
            ))}

            {halfLife !== null ? (
              <g>
                <line
                  x1={x(halfLife)}
                  x2={x(halfLife)}
                  y1={PAD.top}
                  y2={H - PAD.bottom}
                  stroke={color.alarm[400]}
                  strokeDasharray="2 3"
                />
                <circle cx={x(halfLife)} cy={y(0.5)} r={4} fill={color.alarm[400]} />
                <text
                  x={x(halfLife) + 6}
                  y={y(0.5) - 8}
                  className="font-mono"
                  fontSize="11"
                  fill={color.alarm[400]}
                >
                  t½ = {halfLife.toFixed(1)}
                </text>
              </g>
            ) : null}
          </svg>

          <div className="mt-snug flex flex-wrap gap-gutter font-mono text-micro">
            <span className="flex items-center gap-tight text-ink-secondary">
              <span className="h-0.5 w-6" style={{ background: color.coherence[400] }} />
              {supervisedLabel}
              {supHalfLife === null ? ' · never crossed 0.5' : ` · t½ ${supHalfLife.toFixed(1)}`}
            </span>
            <span className="flex items-center gap-tight text-ink-secondary">
              <span className="h-0.5 w-6" style={{ background: color.alarm[400] }} />
              {unsupervisedLabel}
              {halfLife === null ? ' · never crossed 0.5' : ` · t½ ${halfLife.toFixed(1)}`}
            </span>
            <span className="text-ink-muted">dashed vertical = intervention</span>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
        {(
          [
            [supervisedLabel, supervised, sup, true],
            [unsupervisedLabel, unsupervised, uns, false],
          ] as const
        ).map(([label, events, d, isSupervised]) => (
          <Panel
            key={label}
            title={label}
            status={
              <span className="font-mono text-micro">
                <span className={clsx(isSupervised ? 'text-coherence-400' : 'text-alarm-400')}>
                  {d.rollbacksCount} rollback{d.rollbacksCount === 1 ? '' : 's'}
                </span>
                <span className="text-ink-muted"> · {d.passing}/12</span>
              </span>
            }
          >
            <div className="p-panel">
              <TimelineTrack events={toTimeline(events)} arcs={d.arcs} domain={domain} height={110} />
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}
