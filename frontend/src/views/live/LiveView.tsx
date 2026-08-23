/**
 * The flight recorder.
 *
 * Renders one run from its event stream. The screen is ordered by what the run is about: coherence
 * against its calibrated gates first, the window that produced the current score underneath it,
 * then the laned event spine, then the three state panels.
 *
 * The earlier layout led with a dial. A dial answers "what is C now", which is the one question the
 * event log already answers in its last line. What the room needs is the shape of the fall, the
 * distance past the gate, and the range the supervisor threw away to climb back — all of which are
 * time-series facts, so the time series leads.
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  CheckpointDiamond,
  CoherenceChart,
  DEFAULT_THRESHOLDS,
  EventGlyph,
  Panel,
  TimelineTrack,
  type EventType,
  type TimelineEvent,
} from '../../components/core'
import type { DhruvaEvent } from '../../contracts'
import { derive, type CoherencePoint, type LedgerRow } from '../../data/derive'
import type { DhruvaConfig, LedgerEntryView } from '../../data/api'
import { WindowDetail } from './WindowDetail'

export interface LiveViewProps {
  events: readonly DhruvaEvent[]
  config?: DhruvaConfig | null
  ledger?: readonly LedgerEntryView[]
  connected?: boolean
  label?: string
  projected?: boolean
  playhead?: number | null
  onSelect?: (event: DhruvaEvent) => void
}

/** Three lanes, three verbs. What the supervisor did stops competing with what the agent did. */
const LANE_LABELS = ['verify', 'act', 'learn'] as const

const LANE_OF: Readonly<Record<EventType, number>> = {
  verification: 0,
  checkpoint: 0,
  breach: 0,
  rollback: 0,
  resume: 0,
  swarm_verification: 0,
  swarm_checkpoint: 0,
  task_start: 1,
  action: 1,
  observation: 1,
  task_complete: 1,
  // Corruption arrives through the agent's own input. Drawing it anywhere else would flatter us.
  injection: 1,
  memory_op: 2,
  learning: 2,
  ledger_audit: 2,
  quarantine: 2,
  bulletin: 2,
}

const VERDICT_TEXT = {
  pass: 'text-coherence-400',
  warn: 'text-state-warn',
  breach: 'text-alarm-400',
} as const

const EVICT_AT = 0.5

/** `tests/test_metrics.py::test_x` -> `metrics`. Groups the lamp board by the module it covers. */
function moduleOf(nodeId: string): string {
  const file = nodeId.split('::')[0].split('/').pop() ?? nodeId
  return file.replace(/^test_/, '').replace(/\.py$/, '')
}

function TestBoard({ perTest }: { perTest: Record<string, 'pass' | 'fail'> }) {
  const entries = Object.entries(perTest)
  if (!entries.length) {
    return <p className="text-caption text-ink-muted">No test results yet.</p>
  }

  const groups = new Map<string, [string, string][]>()
  for (const [nodeId, outcome] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const key = moduleOf(nodeId)
    const bucket = groups.get(key)
    if (bucket) bucket.push([nodeId, outcome])
    else groups.set(key, [[nodeId, outcome]])
  }

  return (
    <div className="flex flex-col gap-tight">
      {[...groups].map(([module, tests]) => (
        <div key={module} className="flex items-center gap-snug">
          <span className="w-16 shrink-0 truncate font-mono text-micro text-ink-muted">{module}</span>
          <div className="flex gap-hair">
            {tests.map(([nodeId, outcome]) => (
              <span
                key={nodeId}
                title={`${nodeId} — ${outcome}`}
                className={clsx(
                  'h-4 w-10 rounded-tick border transition-colors',
                  outcome === 'pass'
                    ? 'border-state-pass bg-state-pass/70'
                    : 'border-edge-default bg-base-700',
                )}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-tight">
      <span className="font-mono text-micro tracking-[0.14em] text-ink-muted uppercase">{label}</span>
      <span className={clsx('font-mono text-caption tabular-nums', tone ?? 'text-ink-primary')}>
        {value}
      </span>
    </div>
  )
}

export default function LiveView({
  events,
  config,
  ledger = [],
  connected = false,
  label = 'run',
  projected = false,
  playhead = null,
  onSelect,
}: LiveViewProps) {
  const [selected, setSelected] = useState<DhruvaEvent | null>(null)
  const [pinnedWindow, setPinnedWindow] = useState<number | null>(null)
  const d = useMemo(() => derive(events), [events])

  const timelineEvents: TimelineEvent[] = useMemo(
    () =>
      events.map((e) => ({
        seq: e.seq,
        type: e.type,
        ts: e.ts,
        poisoned: e.type === 'observation' && Boolean((e.payload as { poisoned?: boolean }).poisoned),
      })),
    [events],
  )

  const thresholds = config?.thresholds ?? DEFAULT_THRESHOLDS
  const weights = config?.weights ?? { alignment: 0.6, repetition: 0.2, progress: 0.2 }
  const latest = d.latest
  const passing = d.passing
  const audit = d.audits.at(-1) ?? null

  // A pinned window survives until the presenter picks another. Otherwise it follows the stream,
  // which is what you want while a run is playing.
  const shownWindow: CoherencePoint | null =
    (pinnedWindow !== null ? d.coherence.find((p) => p.seq === pinnedWindow) : null) ?? latest

  const domain: [number, number] = events.length
    ? [events[0].seq, events[events.length - 1].seq]
    : [0, 1]

  // Prefer the backend's ledger, which carries live eviction state. A canned replay has no registry
  // to ask, so fall back to the same rows reconstructed from the log.
  const rows: LedgerRow[] = ledger.length
    ? ledger.map((e) => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        seq: e.minted_at_seq,
        sourceSeqs: e.source_seqs,
        status: e.status === 'evicted' ? 'evicted' : 'clean',
        reason: e.status_reason ?? undefined,
      }))
    : d.ledgerRows
  const evictedCount = rows.filter((r) => r.status === 'evicted').length

  const selectEvent = (seq: number) => {
    const full = events.find((x) => x.seq === seq) ?? null
    setSelected(full)
    if (full) onSelect?.(full)
  }

  return (
    <div className="flex flex-col gap-gutter">
      {projected ? (
        <div className="rounded-panel border border-state-warn/50 bg-state-warn/10 px-panel py-snug font-mono text-micro tracking-[0.18em] text-state-warn uppercase">
          projected — synthetic log, not a live run
        </div>
      ) : null}

      <Panel
        title={`coherence · ${label}`}
        status={
          <div className="flex items-center gap-snug font-mono text-micro">
            <span className={clsx(connected ? 'text-state-pass' : 'text-ink-muted')}>
              {connected ? '● live' : '○ idle'}
            </span>
            <span className="text-ink-muted">
              C = {weights.alignment}·align + {weights.repetition}·repeat + {weights.progress}·progress
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-panel lg:grid-cols-[minmax(0,1fr)_180px]">
          <CoherenceChart
            points={d.coherence}
            thresholds={thresholds}
            domain={domain}
            discarded={d.rollbacks.map((r) => r.discarded)}
            injections={d.injections.map((i) => i.seq)}
            selectedSeq={shownWindow?.seq ?? null}
            onSelect={(p) => {
              setPinnedWindow(p.seq)
              selectEvent(p.seq)
            }}
          />

          <div className="flex flex-col justify-center gap-tight border-edge-subtle lg:border-l lg:pl-panel">
            <span className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
              latest
            </span>
            <span
              className={clsx(
                'font-mono text-display leading-none font-semibold tabular-nums',
                latest ? VERDICT_TEXT[latest.verdict] : 'text-ink-muted',
              )}
            >
              {latest ? latest.coherence.toFixed(3) : '—'}
            </span>
            <div className="mt-tight flex flex-col gap-tick border-t border-edge-subtle pt-tight">
              <Stat label="tests" value={`${passing}/12`} />
              <Stat label="windows" value={String(d.coherence.length)} />
              <Stat
                label="breaches"
                value={String(d.breaches.length)}
                tone={d.breaches.length ? 'text-alarm-400' : undefined}
              />
              <Stat
                label="rollbacks"
                value={String(d.rollbacksCount)}
                tone={d.rollbacksCount ? 'text-alarm-400' : undefined}
              />
            </div>
          </div>
        </div>

        {d.testsTampered ? (
          <p className="mt-snug rounded-mark border border-alarm-400/50 bg-alarm-400/10 px-snug py-tick font-mono text-caption text-alarm-400">
            Ground truth compromised — test files differ from the shipped baseline. A tampered
            measurement breaches regardless of C.
          </p>
        ) : null}

        <div className="mt-panel border-t border-edge-subtle pt-panel">
          <WindowDetail point={shownWindow} weights={weights} judge={config?.models.judge} />
        </div>
      </Panel>

      <Panel
        title="event stream"
        status={
          <div className="flex items-center gap-tight font-mono text-micro">
            <span className="text-ink-muted">{events.length} events</span>
            {d.breaches.length ? (
              <span className="rounded-pill border border-alarm-400 px-2 text-alarm-400">
                {d.breaches.length} breach{d.breaches.length > 1 ? 'es' : ''}
              </span>
            ) : null}
          </div>
        }
      >
        <TimelineTrack
          events={timelineEvents}
          arcs={d.arcs}
          playhead={playhead}
          height={186}
          laneLabels={LANE_LABELS}
          laneOf={(e) => LANE_OF[e.type] ?? 1}
          selectedSeq={selected?.seq ?? null}
          onSelect={(e) => selectEvent(e.seq)}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
        <Panel
          title="test board"
          status={<span className="font-mono text-micro text-ink-muted tabular-nums">{passing}/12</span>}
        >
          <TestBoard perTest={d.progress?.per_test ?? {}} />
        </Panel>

        <Panel
          title="checkpoint chain"
          status={
            <span className="font-mono text-micro text-ink-muted tabular-nums">
              {d.checkpoints.filter((c) => c.confirmed).length}/{d.checkpoints.length} confirmed
            </span>
          }
        >
          <div className="flex flex-wrap gap-tight">
            {d.checkpoints.length === 0 ? (
              <p className="text-caption text-ink-muted">No checkpoints yet.</p>
            ) : (
              d.checkpoints.map((c) => (
                <CheckpointDiamond
                  key={c.id}
                  checkpointId={c.id}
                  seq={c.seq}
                  verified={c.confirmed}
                />
              ))
            )}
          </div>
          <p className="mt-snug text-micro text-ink-muted">
            A checkpoint confirms once the following window also passes. Only a confirmed checkpoint
            is a valid rollback target.
          </p>
        </Panel>

        <Panel
          title="knowledge ledger"
          status={
            <span className="font-mono text-micro tabular-nums">
              <span className="text-state-pass">{rows.length - evictedCount} kept</span>
              {' · '}
              <span className={evictedCount ? 'text-alarm-400' : 'text-ink-muted'}>
                {evictedCount} evicted
              </span>
            </span>
          }
        >
          <div className="flex max-h-64 flex-col gap-tight overflow-y-auto">
            {rows.length === 0 ? <p className="text-caption text-ink-muted">Nothing learned yet.</p> : null}
            {rows.map((entry) => {
              const cited = selected ? entry.sourceSeqs.includes(selected.seq) : false
              return (
                <div
                  key={entry.id}
                  className={clsx(
                    'rounded-mark border px-snug py-tick text-caption',
                    entry.status === 'evicted'
                      ? 'border-alarm-400/50 bg-alarm-400/10 text-ink-muted'
                      : 'border-edge-subtle text-ink-secondary',
                    cited && 'ring-1 ring-ink-primary',
                  )}
                >
                  <span className="font-mono text-micro text-ink-muted">[{entry.kind}]</span>{' '}
                  <span className={entry.status === 'evicted' ? 'line-through' : undefined}>
                    {entry.text}
                  </span>
                  {entry.status === 'evicted' ? (
                    <span className="mt-tick block font-mono text-micro text-alarm-400 tabular-nums">
                      evicted · {(entry.reason ?? 'tainted').replace(/_/g, ' ')}
                      {entry.taint !== undefined
                        ? ` · taint ${entry.taint.toFixed(2)} ≥ ${EVICT_AT.toFixed(2)}`
                        : ''}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
          {audit ? (
            <p className="mt-snug text-micro text-ink-muted">
              The audit is deterministic and runs with no model call. It evicts on provenance, not on
              truth: a belief sourced after the injection goes, however correct it still looks.
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="event inspector"
        status={<span className="font-mono text-micro text-ink-muted">payload</span>}
      >
        {selected ? (
          <div className="flex flex-col gap-snug">
            <div className="flex flex-wrap items-center gap-tight">
              <EventGlyph type={selected.type} size={18} />
              <span className="font-mono text-caption text-ink-primary">
                seq {selected.seq} · {selected.type}
              </span>
              <span className="font-mono text-micro text-ink-muted">{selected.ts}</span>
              {selected.checkpoint_ref ? (
                <span className="font-mono text-micro text-ink-muted">
                  under {selected.checkpoint_ref}
                </span>
              ) : null}
            </div>
            <pre className="max-h-52 overflow-auto rounded-mark bg-base-900 p-snug font-mono text-micro text-ink-secondary">
              {JSON.stringify(selected.payload, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="text-caption text-ink-muted">
            Pick an event on the stream, or a point on the chart, to inspect it.
          </p>
        )}
      </Panel>
    </div>
  )
}
