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
  /** The three named scores behind the blend. C hides which one moved; these do not. */
  alignment: number
  repetition: number
  progress: number
  /** The judge's own sentence. On the breach window this is the most load-bearing string here. */
  rationale: string
  window: [number, number]
  violatedConstraints: string[]
  testsTampered: boolean
}

/**
 * One knowledge-ledger row with its audit outcome folded in.
 *
 * The live path fetches this from /ledger, but a canned replay has no backend registry to ask, so
 * the same rows have to be reconstructable from the log alone. Otherwise the demo path shows every
 * entry as clean and the eviction — the thing the run is about — never appears.
 */
export interface LedgerRow {
  id: string
  kind: string
  text: string
  seq: number
  sourceSeqs: number[]
  status: 'clean' | 'evicted'
  reason?: string
  taint?: number
}

export interface RollbackSpan {
  seq: number
  fromSeq: number
  toSeq: number
  targetId: string
  discarded: [number, number]
}

export interface DerivedRun {
  coherence: CoherencePoint[]
  latest: CoherencePoint | null
  checkpoints: { id: string; seq: number; confirmed: boolean }[]
  arcs: TimelineArc[]
  progress: ProgressResult | null
  learnings: { entryId: string; kind: string; text: string; seq: number; sourceSeqs: number[] }[]
  audits: (LedgerAuditPayload & { seq: number })[]
  ledgerRows: LedgerRow[]
  rollbacks: RollbackSpan[]
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
  const rollbacks: RollbackSpan[] = []
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
        alignment: event.payload.alignment,
        repetition: event.payload.repetition,
        progress: event.payload.progress,
        rationale: event.payload.rationale,
        window: event.payload.window,
        violatedConstraints: event.payload.violated_constraints ?? [],
        testsTampered: Boolean(event.payload.tests_tampered),
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
      const toSeq = target?.seq ?? event.payload.discarded_range[0]
      arcs.push({
        id: `rb-${event.seq}`,
        fromSeq: event.payload.from_seq,
        toSeq,
        label: `rollback to ${event.payload.target_checkpoint_id}`,
      })
      rollbacks.push({
        seq: event.seq,
        fromSeq: event.payload.from_seq,
        toSeq,
        targetId: event.payload.target_checkpoint_id,
        discarded: event.payload.discarded_range,
      })
      // D11.4 — a rollback truncates the chain AT its target. A checkpoint minted inside the
      // discarded range no longer exists on the backend, and a UI that keeps drawing it is
      // showing a rollback target that cannot be rolled back to.
      if (target) {
        for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
          if (checkpoints[i].seq > target.seq) checkpoints.splice(i, 1)
        }
      }
    } else if (isEvent('learning')(event)) {
      learnings.push({
        entryId: event.payload.entry_id,
        kind: event.payload.kind,
        text: event.payload.text,
        seq: event.seq,
        sourceSeqs: event.payload.source_seqs,
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

  // Fold every audit verdict back onto the entries it judged. Latest audit wins: a later rollback
  // can evict something an earlier one kept.
  const ledgerRows: LedgerRow[] = learnings.map((l) => ({
    id: l.entryId,
    kind: l.kind,
    text: l.text,
    seq: l.seq,
    sourceSeqs: l.sourceSeqs,
    status: 'clean' as const,
  }))
  const byId = new Map(ledgerRows.map((row) => [row.id, row]))
  for (const audit of audits) {
    for (const entry of audit.evicted) {
      const row = byId.get(entry.entry_id)
      if (!row) continue
      row.status = 'evicted'
      row.reason = entry.reason
      row.taint = entry.taint_score
    }
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
    ledgerRows,
    rollbacks,
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
export function coherenceHalfLife(
  points: readonly Pick<CoherencePoint, 'seq' | 'coherence' | 'verdict'>[],
  level = 0.5,
): number | null {
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
