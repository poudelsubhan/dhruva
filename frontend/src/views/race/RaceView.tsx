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

/** One row of twelve. Compact enough that two rows fit inside a pane. */
function Board({
  perTest,
  label,
  count,
  tone,
}: {
  perTest: Record<string, 'pass' | 'fail'>
  label: string
  count: number
  tone: 'truth' | 'belief'
}) {
  const cells = Object.values(perTest)
  const filled = cells.length ? cells : Array.from({ length: 12 }, () => 'fail' as const)
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 font-mono text-micro tracking-[0.14em] text-ink-muted uppercase">
        {label}
      </span>
      <div className="flex gap-1">
        {filled.slice(0, 12).map((outcome, i) => (
          <span
            key={i}
            className={clsx(
              'h-5 w-5 rounded-[3px] border transition-all duration-500',
              outcome === 'pass'
                ? tone === 'belief'
                  ? 'border-state-warn bg-state-warn/80'
                  : 'border-state-pass bg-state-pass'
                : 'border-edge-default bg-base-700',
            )}
          />
        ))}
      </div>
      <span
        className={clsx(
          'ml-auto font-mono text-body font-bold tabular-nums',
          tone === 'belief' ? 'text-state-warn' : count === 12 ? 'text-state-pass' : 'text-ink-primary',
        )}
      >
        {count}/12
      </span>
    </div>
  )
}

function Pane({
  title,
  events,
  seq,
  accent,
  note,
  evictedOverride,
}: {
  title: string
  events: readonly DhruvaEvent[]
  seq: number
  accent: 'coherence' | 'alarm'
  note: string | null
  /** Applied while the audit beat is held, before its event has been reached by the clock. */
  evictedOverride?: readonly string[]
}) {
  const shown = useMemo(() => events.filter((e) => e.seq <= seq), [events, seq])
  const d = useMemo(() => derive(shown), [shown])
  const deceived = d.believed !== d.passing
  const evicted = new Set(evictedOverride ?? d.evictedIds)
  const feed = d.actions.slice(-3)
  const beliefs = useMemo(() => {
    const gone = d.learnings.filter((l) => evicted.has(l.entryId))
    const kept = d.learnings.filter((l) => !evicted.has(l.entryId))
    // Evicted first: the strike-through IS the audit, and burying it defeats the beat.
    return gone.length ? [...gone.slice(-3), ...kept.slice(-1)] : kept.slice(-4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.learnings, d.evictedIds, evictedOverride])

  return (
    <section
      className={clsx(
        'flex min-w-0 flex-1 flex-col gap-2.5 rounded-panel border bg-base-800 p-3.5 transition-all duration-500',
        accent === 'coherence' ? 'border-coherence-400/40' : 'border-alarm-400/40',
        deceived && 'border-state-warn',
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2
          className={clsx(
            'font-mono text-small font-semibold tracking-[0.2em] uppercase',
            accent === 'coherence' ? 'text-coherence-400' : 'text-alarm-400',
          )}
        >
          {title}
        </h2>
        <span className="font-mono text-micro text-ink-muted">
          C {d.latest ? d.latest.coherence.toFixed(2) : '—'}
          {d.rollbacksCount ? ` · ${d.rollbacksCount} rollback` : ''}
        </span>
      </header>

      <div className="flex flex-col gap-1.5 rounded-mark bg-base-900/60 p-3">
        <Board
          perTest={d.agentProgress?.per_test ?? d.progress?.per_test ?? {}}
          label="believes"
          count={d.believed}
          tone="belief"
        />
        <Board
          perTest={d.progress?.per_test ?? {}}
          label="truth"
          count={d.passing}
          tone="truth"
        />
        {deceived ? (
          <p className="pt-1 font-mono text-micro tracking-[0.1em] text-state-warn uppercase">
            ▲ the agent has been lied to
          </p>
        ) : null}
      </div>

      <div className="flex min-h-[4rem] flex-col gap-0.5 font-mono text-micro">
        {feed.length === 0 ? <span className="text-ink-muted">waiting…</span> : null}
        {feed.map((a, i) => (
          <div
            key={a.seq}
            className={clsx(
              'truncate',
              i === feed.length - 1 ? 'text-ink-primary' : 'text-ink-muted',
              a.poisoned && 'text-state-warn',
            )}
          >
            <span className="text-ink-muted">{a.step}› </span>
            {a.text}
            {a.poisoned ? ' ← lied to' : ''}
          </div>
        ))}
      </div>

      <div className="mt-auto flex min-h-[5rem] flex-col gap-0.5">
        <span className="font-mono text-micro tracking-[0.14em] text-ink-muted uppercase">
          knowledge
        </span>
        {beliefs.length === 0 ? (
          <span className="font-mono text-micro text-ink-muted">nothing learned yet</span>
        ) : null}
        {beliefs.map((b) => (
          <div
            key={b.entryId}
            className={clsx(
              'truncate text-micro',
              evicted.has(b.entryId)
                ? 'text-alarm-400 line-through decoration-alarm-400'
                : 'text-ink-secondary',
            )}
          >
            {evicted.has(b.entryId) ? '✕ ' : '• '}
            {b.text}
          </div>
        ))}
      </div>

      {note ? (
        <p
          className={clsx(
            'font-mono text-small tracking-[0.06em]',
            accent === 'coherence' ? 'text-coherence-400' : 'text-alarm-400',
          )}
        >
          {note}
        </p>
      ) : null}
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

  // The lie, verbatim, once it has landed. It is the same in both runs, so it belongs across the
  // top rather than duplicated -- and it is the single most important thing on the screen.
  const supDerived = useMemo(() => derive(supervised.filter((e) => e.seq <= seq)), [supervised, seq])
  const lie = supDerived.poisonedContent
  const truthLine = `${supDerived.passing}/12 actually passing`

  // Once the audit beat is reached, strike the evicted beliefs even though the audit event itself is
  // a seq or two ahead of where the clock is held.
  const stageEvicted = useMemo(() => {
    if (stage !== 'audit' && stage !== 'preflight') return undefined
    const all = derive(supervised).audits
    const a = all.filter((x) => x.rollback_ref <= seq + 2).at(-1) ?? all.at(-1)
    return a?.evicted.map((e) => e.entry_id)
  }, [stage, supervised, seq])

  return (
    <div className="relative flex flex-col gap-4">
      <div className="flex items-center justify-between font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
        <span>same task · same sabotage at step 12 · same schedule</span>
        <span>seq {seq}</span>
      </div>

      {stage ? <StageBand stage={stage} supervised={supervised} seq={seq} /> : null}
      {lie ? <TheLie content={lie} truth={truthLine} /> : null}

      <div className="flex flex-row gap-4">
        <Pane
          title="supervised"
          events={supervised}
          seq={seq}
          accent="coherence"
          note={stageNote ?? supNote}
          evictedOverride={stageEvicted}
        />
        <Pane
          title="unsupervised"
          events={unsupervised}
          seq={seq}
          accent="alarm"
          note={unsNote}
        />
      </div>
    </div>
  )
}

/** What the tool told the agent, next to what was true. */
function TheLie({ content, truth }: { content: string; truth: string }) {
  const lines = content.trim().split('\n')
  const summary = lines[lines.length - 1] ?? ''
  return (
    <div className="flex items-stretch gap-3 rounded-panel border border-state-warn/60 bg-state-warn/5 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-micro tracking-[0.16em] text-state-warn uppercase">
          what the tool reported
        </div>
        <div className="truncate font-mono text-body text-state-warn">{summary}</div>
      </div>
      <div className="w-px bg-state-warn/30" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-micro tracking-[0.16em] text-ink-muted uppercase">
          what was true
        </div>
        <div className="truncate font-mono text-body text-alarm-400">{truth}</div>
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
  const audit = useMemo(() => {
    const all = derive(supervised)
    const forThisRollback = all.audits.filter((a) => a.rollback_ref <= seq + 2)
    return forThisRollback.at(-1) ?? all.audits.at(-1) ?? null
  }, [supervised, seq])

  return (
    <div className="rounded-panel border border-coherence-400 bg-coherence-400/5 px-4 py-2.5">
      <div className="flex flex-col gap-2">
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
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="font-mono text-body font-bold tracking-[0.12em] text-coherence-400 uppercase">
            {meta.label}
          </h3>
          <p className="text-small text-ink-secondary">{meta.detail}</p>
          {stage === 'audit' && audit ? (
            <span className="ml-auto font-mono text-body font-bold">
              <span className="text-state-pass">{audit.retained.length} kept</span>
              <span className="text-ink-muted"> · </span>
              <span className="text-alarm-400">{audit.evicted.length} evicted</span>
            </span>
          ) : null}
        </div>
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
