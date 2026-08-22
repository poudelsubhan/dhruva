/**
 * Derived views over an event stream.
 *
 * Everything the UI shows is computed from the event log alone — no side-channel state. That is
 * what lets replay render identically to live: same events in, same picture out.
 */

import type { DhruvaEvent, LedgerAuditPayload, ProgressResult } from '../contracts'
import { isEvent } from '../contracts'
import type { TimelineArc } from '../components/core'

export interface CoherencePoint {
  seq: number
  coherence: number
  verdict: 'pass' | 'warn' | 'breach'
  step?: number
}

export interface DerivedRun {
  coherence: CoherencePoint[]
  latest: CoherencePoint | null
  checkpoints: { id: string; seq: number; confirmed: boolean }[]
  arcs: TimelineArc[]
  progress: ProgressResult | null
  learnings: { entryId: string; kind: string; text: string; seq: number }[]
  audits: (LedgerAuditPayload & { seq: number })[]
  injections: { scenario: string; seq: number }[]
  poisonedSeqs: number[]
  breaches: number[]
  complete: { success: boolean; steps: number } | null
  testsTampered: boolean
  /** Convenience for panel headers. */
  rollbacksCount: number
  passing: number
}

export function derive(events: readonly DhruvaEvent[]): DerivedRun {
  const coherence: CoherencePoint[] = []
  const checkpoints: DerivedRun['checkpoints'] = []
  const arcs: TimelineArc[] = []
  const learnings: DerivedRun['learnings'] = []
  const audits: DerivedRun['audits'] = []
  const injections: DerivedRun['injections'] = []
  const poisonedSeqs: number[] = []
  const breaches: number[] = []
  let progress: ProgressResult | null = null
  let complete: DerivedRun['complete'] = null
  let testsTampered = false

  for (const event of events) {
    if (isEvent('verification')(event)) {
      coherence.push({
        seq: event.seq,
        coherence: event.payload.coherence,
        verdict: event.payload.verdict,
      })
      if (event.payload.tests_tampered) testsTampered = true
    } else if (isEvent('checkpoint')(event)) {
      checkpoints.push({
        id: event.payload.id,
        seq: event.seq,
        confirmed: Boolean(event.payload.confirmed),
      })
    } else if (isEvent('rollback')(event)) {
      const target = checkpoints.find((c) => c.id === event.payload.target_checkpoint_id)
      arcs.push({
        id: `rb-${event.seq}`,
        fromSeq: event.payload.from_seq,
        toSeq: target?.seq ?? event.payload.discarded_range[0],
        label: `rollback to ${event.payload.target_checkpoint_id}`,
      })
    } else if (isEvent('learning')(event)) {
      learnings.push({
        entryId: event.payload.entry_id,
        kind: event.payload.kind,
        text: event.payload.text,
        seq: event.seq,
      })
    } else if (isEvent('ledger_audit')(event)) {
      audits.push({ ...event.payload, seq: event.seq })
    } else if (isEvent('injection')(event)) {
      injections.push({ scenario: event.payload.scenario, seq: event.seq })
    } else if (isEvent('observation')(event)) {
      if (event.payload.poisoned) poisonedSeqs.push(event.seq)
      if (event.payload.progress) progress = event.payload.progress
    } else if (isEvent('breach')(event)) {
      breaches.push(event.seq)
    } else if (isEvent('task_complete')(event)) {
      progress = event.payload.progress
      complete = { success: event.payload.success, steps: event.payload.steps ?? 0 }
    }
  }

  // Confirmation happens after a checkpoint is emitted, so it arrives as a memory_op rather than
  // by mutating the original event. Fold it back in — the UI must be able to show which
  // checkpoints are actually valid rollback targets.
  for (const event of events) {
    if (!isEvent('memory_op')(event)) continue
    const match = /checkpoint (\S+) confirmed/.exec(event.payload.detail)
    if (!match) continue
    const target = checkpoints.find((c) => c.id === match[1])
    if (target) target.confirmed = true
  }

  const passing = progress
    ? Object.values(progress.per_test).filter((v) => v === 'pass').length
    : 0

  return {
    coherence,
    latest: coherence.at(-1) ?? null,
    checkpoints,
    arcs,
    progress,
    learnings,
    audits,
    injections,
    poisonedSeqs,
    breaches,
    complete,
    testsTampered,
    rollbacksCount: arcs.length,
    passing,
  }
}

/** Half-life: linear interpolation of the first crossing of C = 0.5. */
export function coherenceHalfLife(points: readonly CoherencePoint[], level = 0.5): number | null {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    if (a.coherence >= level && b.coherence < level) {
      const span = a.coherence - b.coherence
      const t = span === 0 ? 0 : (a.coherence - level) / span
      return a.seq + t * (b.seq - a.seq)
    }
  }
  return null
}
