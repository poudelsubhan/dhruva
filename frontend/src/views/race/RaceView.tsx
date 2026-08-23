/**
 * The split-screen race — the demo's centrepiece.
 *
 * Two real runs on one clock: same task, same sabotage at the same step, and the supervisor allowed
 * to intervene in only one of them. They share a sequence space for the first 47 events, so a single
 * counter drives both panes and the divergence happens in front of the audience rather than being
 * summarised in a table afterwards.
 *
 * The moment that matters is around seq 61-63, and it is worth saying out loud: BOTH runs detect the
 * drift. The unsupervised one is not blind, it just is not permitted to act. That is what makes this
 * a controlled comparison rather than a demo.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { DhruvaEvent } from '../../contracts'
import { derive } from '../../data/derive'

export interface RaceViewProps {
  supervised: readonly DhruvaEvent[]
  unsupervised: readonly DhruvaEvent[]
  seq: number
  /** Set while the staged rollback is holding, so the panes can dim behind the overlay. */
  stage?: RollbackStage | null
}

export type RollbackStage = 'halt' | 'restore' | 'audit' | 'preflight' | null

/** The four beats of a rollback, held one at a time so the mechanism can be narrated. */
export const STAGES: { key: Exclude<RollbackStage, null>; label: string; detail: string }[] = [
  { key: 'halt', label: 'HALT', detail: 'drift confirmed — stepping stops' },
  { key: 'restore', label: 'RESTORE', detail: 'files reverted to the last confirmed checkpoint' },
  { key: 'audit', label: 'AUDIT', detail: 'knowledge kept, contaminated beliefs evicted' },
  { key: 'preflight', label: 'PRE-FLIGHT', detail: 'next step checked before it may run' },
]

const GROUP_OF = (nodeId: string): 'A' | 'B' | 'C' => {
  if (nodeId.includes('ingest') || nodeId.includes('parser')) return 'A'
  if (nodeId.includes('metrics') || nodeId.includes('sessions')) return 'B'
  return 'C'
}

function Lamps({ perTest, dim }: { perTest: Record<string, 'pass' | 'fail'>; dim: boolean }) {
  const entries = Object.entries(perTest)
  const groups: Record<string, [string, string][]> = { A: [], B: [], C: [] }
  for (const [id, outcome] of entries) groups[GROUP_OF(id)].push([id, outcome])
  const empty = entries.length === 0

  return (
    <div className={clsx('flex flex-col gap-2 transition-opacity', dim && 'opacity-40')}>
      {(['A', 'B', 'C'] as const).map((g) => (
        <div key={g} className="flex items-center gap-2">
          <span className="w-3 font-mono text-micro text-ink-muted">{g}</span>
          <div className="flex gap-2">
            {(empty ? Array.from({ length: 4 }, () => ['', 'fail'] as [string, string]) : groups[g]).map(
              ([id, outcome], i) => (
                <span
                  key={id || i}
                  title={id}
                  className={clsx(
                    'h-7 w-14 rounded-mark border transition-all duration-500',
                    outcome === 'pass'
                      ? 'border-state-pass bg-state-pass shadow-[0_0_18px_-2px] shadow-state-pass'
                      : 'border-edge-default bg-base-700',
                  )}
                />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Pane({
  title,
  events,
  seq,
  accent,
  dim,
  note,
}: {
  title: string
  events: readonly DhruvaEvent[]
  seq: number
  accent: 'coherence' | 'alarm'
  dim: boolean
  note: string | null
}) {
  const shown = useMemo(() => events.filter((e) => e.seq <= seq), [events, seq])
  const d = useMemo(() => derive(shown), [shown])
  const passing = d.progress
    ? Object.values(d.progress.per_test).filter((v) => v === 'pass').length
    : 0
  const coherence = d.latest?.coherence ?? null
  const verdict = d.latest?.verdict ?? null
  const breached = d.breaches.length > 0
  const rolledBack = d.arcs.length > 0
  const complete = d.complete

  return (
    <section
      className={clsx(
        'flex min-w-0 flex-1 flex-col gap-5 rounded-panel border bg-base-800 p-6 transition-all duration-500',
        accent === 'coherence' ? 'border-coherence-400/40' : 'border-alarm-400/40',
        breached && !rolledBack && 'border-alarm-400',
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2
          className={clsx(
            'font-mono text-lead font-semibold tracking-[0.2em] uppercase',
            accent === 'coherence' ? 'text-coherence-400' : 'text-alarm-400',
          )}
        >
          {title}
        </h2>
        <span className="font-mono text-micro text-ink-muted">
          {rolledBack ? `${d.arcs.length} rollback` : 'no intervention'}
        </span>
      </header>

      <div className="flex items-end gap-6">
        <div>
          <div
            className={clsx(
              'font-mono text-readout leading-none font-bold tabular-nums transition-colors duration-500',
              passing === 12 ? 'text-state-pass' : passing === 0 ? 'text-alarm-400' : 'text-ink-primary',
            )}
          >
            {passing}
            <span className="text-ink-muted">/12</span>
          </div>
          <div className="mt-1 font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
            tests passing
          </div>
        </div>
        <div className="ml-auto text-right">
          <div
            className={clsx(
              'font-mono text-title leading-none tabular-nums transition-colors duration-500',
              verdict === 'breach'
                ? 'text-alarm-400'
                : verdict === 'warn'
                  ? 'text-state-warn'
                  : 'text-coherence-400',
            )}
          >
            {coherence === null ? '—' : coherence.toFixed(2)}
          </div>
          <div className="mt-1 font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
            coherence
          </div>
        </div>
      </div>

      <Lamps perTest={d.progress?.per_test ?? {}} dim={dim} />

      <div className="mt-auto flex min-h-14 flex-col justify-end gap-1">
        {note ? (
          <p
            className={clsx(
              'font-mono text-body tracking-[0.06em]',
              accent === 'coherence' ? 'text-coherence-400' : 'text-alarm-400',
            )}
          >
            {note}
          </p>
        ) : null}
        <p className="font-mono text-micro text-ink-muted">
          {d.learnings.length} learnings
          {d.audits.length
            ? ` · ${d.audits.at(-1)!.retained.length} kept, ${d.audits.at(-1)!.evicted.length} evicted`
            : ''}
          {complete ? ` · ${complete.success ? 'complete' : 'failed'}` : ''}
        </p>
      </div>
    </section>
  )
}

/** What each pane is doing at this instant, in words the presenter can point at. */
function noteFor(events: readonly DhruvaEvent[], seq: number, supervised: boolean): string | null {
  const d = derive(events.filter((e) => e.seq <= seq))
  if (d.complete) return d.complete.success ? '✓ recovered — 12/12' : '✕ never recovered'
  if (d.arcs.length) return 'rolled back · resumed'
  if (d.breaches.length) return supervised ? 'DRIFT DETECTED' : 'DRIFT DETECTED — no action permitted'
  if (d.poisonedSeqs.length) return 'corrupted — and it still looks fine'
  if (d.injections.length) return 'sabotage injected'
  return null
}

export default function RaceView({ supervised, unsupervised, seq, stage = null }: RaceViewProps) {
  const supNote = noteFor(supervised, seq, true)
  const unsNote = noteFor(unsupervised, seq, false)
  // While a beat is held the supervised pane reports THAT beat, not the run's end state -- otherwise
  // it reads "rolled back · resumed" during HALT, which is ahead of itself.
  const stageNote = stage ? STAGES.find((x) => x.key === stage)!.label : null

  return (
    <div className="relative flex flex-col gap-4">
      <div className="flex items-center justify-between font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
        <span>same task · same sabotage at step 12 · same schedule</span>
        <span>seq {seq}</span>
      </div>

      {stage ? <StageBand stage={stage} supervised={supervised} seq={seq} /> : null}

      <div className="flex flex-row gap-4">
        <Pane
          title="supervised"
          events={supervised}
          seq={seq}
          accent="coherence"
          dim={false}
          note={stageNote ?? supNote}
        />
        <Pane
          title="unsupervised"
          events={unsupervised}
          seq={seq}
          accent="alarm"
          dim={false}
          note={unsNote}
        />
      </div>
    </div>
  )
}

/** The staged rollback. Held one beat at a time so a one-second event can actually be narrated. */
function StageBand({
  stage,
  supervised,
  seq,
}: {
  stage: Exclude<RollbackStage, null>
  supervised: readonly DhruvaEvent[]
  seq: number
}) {
  const meta = STAGES.find((s) => s.key === stage)!
  const index = STAGES.findIndex((s) => s.key === stage)
  const audit = useMemo(
    () => derive(supervised.filter((e) => e.seq <= Math.max(seq, 64))).audits.at(-1) ?? null,
    [supervised, seq],
  )

  return (
    <div className="rounded-panel border border-coherence-400 bg-coherence-400/5 px-6 py-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {STAGES.map((s, i) => (
            <span
              key={s.key}
              className={clsx(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                i <= index ? 'bg-coherence-400' : 'bg-edge-default',
              )}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-baseline gap-4">
          <h3 className="font-mono text-title font-bold tracking-[0.12em] text-coherence-400 uppercase">
            {meta.label}
          </h3>
          <p className="text-body text-ink-secondary">{meta.detail}</p>
        </div>

        {stage === 'audit' && audit ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-mark border border-state-pass/40 bg-state-pass/5 p-4">
              <div className="font-mono text-display font-bold text-state-pass">
                {audit.retained.length}
              </div>
              <div className="font-mono text-micro tracking-[0.16em] text-ink-muted uppercase">
                learnings kept
              </div>
            </div>
            <div className="rounded-mark border border-alarm-400/40 bg-alarm-400/5 p-4">
              <div className="font-mono text-display font-bold text-alarm-400">
                {audit.evicted.length}
              </div>
              <div className="font-mono text-micro tracking-[0.16em] text-ink-muted uppercase">
                traced to the sabotage — evicted
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Drives the shared clock and holds on the rollback beats.
 *
 * Playback is by sequence number rather than event index, because the two logs share a sequence
 * space for their identical prefix -- one counter genuinely means "the same moment" in both.
 */
export function useRaceClock(maxSeq: number, holdAt: number[], durationMs = 75_000) {
  const [seq, setSeq] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [stageIndex, setStageIndex] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  const startedAt = useRef<number | null>(null)

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => {
    if (!playing || stageIndex !== null) return
    if (seq >= maxSeq) {
      setPlaying(false)
      return
    }
    if (startedAt.current === null) startedAt.current = performance.now() - (seq / maxSeq) * durationMs
    const target = ((seq + 1) / maxSeq) * durationMs
    const wait = Math.max(0, target - (performance.now() - startedAt.current))
    timer.current = window.setTimeout(() => {
      const next = seq + 1
      setSeq(next)
      if (holdAt.includes(next)) setStageIndex(0)
    }, wait)
    return clear
  }, [playing, seq, maxSeq, durationMs, stageIndex, holdAt])

  useEffect(() => clear, [])

  const advanceStage = () => {
    setStageIndex((i) => {
      if (i === null) return null
      if (i + 1 >= STAGES.length) {
        startedAt.current = null
        return null
      }
      return i + 1
    })
  }

  return {
    seq,
    playing,
    stage: stageIndex === null ? null : STAGES[stageIndex].key,
    inStage: stageIndex !== null,
    atEnd: seq >= maxSeq,
    advanceStage,
    play: () => {
      startedAt.current = null
      setSeq((s) => (s >= maxSeq ? 0 : s))
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    restart: () => {
      clear()
      startedAt.current = null
      setStageIndex(null)
      setSeq(0)
      setPlaying(true)
    },
    seek: (n: number) => {
      clear()
      startedAt.current = null
      setStageIndex(null)
      setPlaying(false)
      setSeq(Math.max(0, Math.min(n, maxSeq)))
    },
  }
}
