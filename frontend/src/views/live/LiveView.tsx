/**
 * The flight recorder.
 *
 * Renders one run from its event stream: timeline with rollback arcs, streaming coherence, the
 * checkpoint chain, the knowledge ledger, and a twelve-lamp test board.
 *
 * The lamp board is the point of the whole screen. On a breach you watch four lamps go dark, the
 * arc fire, and the same four relight — the mechanism made visible without narration.
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  CheckpointDiamond,
  CoherenceGauge,
  EventGlyph,
  Panel,
  TimelineTrack,
  type TimelineEvent,
} from '../../components/core'
import type { DhruvaEvent } from '../../contracts'
import { derive } from '../../data/derive'
import type { DhruvaConfig, LedgerEntryView } from '../../data/api'

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

const GROUP_OF = (nodeId: string): 'A' | 'B' | 'C' => {
  if (nodeId.includes('ingest') || nodeId.includes('parser')) return 'A'
  if (nodeId.includes('metrics') || nodeId.includes('sessions')) return 'B'
  return 'C'
}

function TestBoard({ perTest }: { perTest: Record<string, 'pass' | 'fail'> }) {
  const entries = Object.entries(perTest)
  if (!entries.length) {
    return <p className="text-small text-ink-muted">No test results yet.</p>
  }
  const groups: Record<string, [string, string][]> = { A: [], B: [], C: [] }
  for (const [nodeId, outcome] of entries) groups[GROUP_OF(nodeId)].push([nodeId, outcome])

  return (
    <div className="flex flex-col gap-snug">
      {(['A', 'B', 'C'] as const).map((group) => (
        <div key={group} className="flex items-center gap-tight">
          <span className="w-4 font-mono text-micro text-ink-muted">{group}</span>
          <div className="flex gap-tight">
            {groups[group].map(([nodeId, outcome]) => (
              <span
                key={nodeId}
                title={`${nodeId} — ${outcome}`}
                className={clsx(
                  'h-4 w-8 rounded-mark border transition-colors',
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

  const sparkline = d.coherence.map((p) => p.coherence)
  const latest = d.latest
  const passing = d.progress ? Object.values(d.progress.per_test).filter((v) => v === 'pass').length : 0
  const audit = d.audits.at(-1) ?? null

  return (
    <div className="flex flex-col gap-gutter">
      {projected ? (
        <div className="rounded-panel border border-state-warn/50 bg-state-warn/10 px-panel py-snug font-mono text-micro tracking-[0.18em] text-state-warn uppercase">
          projected — synthetic log, not a live run
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title={`timeline · ${label}`}
          status={
            <div className="flex items-center gap-tight font-mono text-micro">
              <span className={clsx(connected ? 'text-state-pass' : 'text-ink-muted')}>
                {connected ? '● live' : '○ idle'}
              </span>
              <span className="text-ink-muted">{events.length} events</span>
              {d.breaches.length ? (
                <span className="rounded-pill border border-alarm-400 px-2 text-alarm-400">
                  {d.breaches.length} breach{d.breaches.length > 1 ? 'es' : ''}
                </span>
              ) : null}
            </div>
          }
        >
          <div className="p-panel">
            <TimelineTrack
              events={timelineEvents}
              arcs={d.arcs}
              playhead={playhead}
              onSelect={(e) => {
                const full = events.find((x) => x.seq === e.seq) ?? null
                setSelected(full)
                if (full) onSelect?.(full)
              }}
            />
            {d.testsTampered ? (
              <p className="mt-snug font-mono text-small text-alarm-400">
                GROUND TRUTH COMPROMISED — test files differ from the shipped baseline
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="coherence"
          status={
            <span className="font-mono text-micro text-ink-muted">
              {latest ? latest.verdict.toUpperCase() : '—'}
            </span>
          }
        >
          <div className="flex flex-col items-center gap-snug p-panel">
            {latest ? (
              <CoherenceGauge
                coherence={latest.coherence}
                sparkline={sparkline}
                thresholds={config?.thresholds}
              />
            ) : (
              // No verification has closed yet. Rendering 0.00 here would paint the dial alarm-red
              // the instant a run starts -- the absence of a measurement is not a breach.
              <div className="flex h-40 flex-col items-center justify-center gap-tight text-ink-muted">
                <span className="font-mono text-h2 tabular-nums">—</span>
                <span className="font-mono text-micro tracking-[0.18em] uppercase">
                  awaiting first window
                </span>
              </div>
            )}
            <p className="text-center text-small text-ink-secondary">
              {passing}/12 tests passing
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
        <Panel
          title="test board"
          status={<span className="font-mono text-micro text-ink-muted">{passing}/12</span>}
        >
          <div className="p-panel">
            <TestBoard perTest={d.progress?.per_test ?? {}} />
          </div>
        </Panel>

        <Panel
          title="checkpoint chain"
          status={
            <span className="font-mono text-micro text-ink-muted">
              {d.checkpoints.filter((c) => c.confirmed).length}/{d.checkpoints.length} confirmed
            </span>
          }
        >
          <div className="flex flex-wrap gap-tight p-panel">
            {d.checkpoints.length === 0 ? (
              <p className="text-small text-ink-muted">No checkpoints yet.</p>
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
          <p className="px-panel pb-panel text-micro text-ink-muted">
            Only a confirmed checkpoint is a valid rollback target.
          </p>
        </Panel>

        <Panel
          title="knowledge ledger"
          status={
            audit ? (
              <span className="font-mono text-micro">
                <span className="text-state-pass">{audit.retained.length} kept</span>
                {' · '}
                <span className="text-alarm-400">{audit.evicted.length} evicted</span>
              </span>
            ) : (
              <span className="font-mono text-micro text-ink-muted">{d.learnings.length}</span>
            )
          }
        >
          <div className="flex max-h-56 flex-col gap-tight overflow-y-auto p-panel">
            {ledger.length === 0 && d.learnings.length === 0 ? (
              <p className="text-small text-ink-muted">Nothing learned yet.</p>
            ) : null}
            {(ledger.length
              ? ledger
              : d.learnings.map((l) => ({
                  id: l.entryId,
                  kind: l.kind,
                  text: l.text,
                  status: 'clean' as const,
                }))
            ).map((entry) => (
              <div
                key={entry.id}
                className={clsx(
                  'rounded-mark border px-2 py-1 text-small',
                  entry.status === 'evicted'
                    ? 'border-alarm-400/50 bg-alarm-400/10 text-ink-muted line-through'
                    : 'border-edge-subtle text-ink-secondary',
                )}
              >
                <span className="font-mono text-micro text-ink-muted">[{entry.kind}]</span>{' '}
                {entry.text}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="event inspector" status={<span className="font-mono text-micro text-ink-muted">payload</span>}>
        <div className="p-panel">
          {selected ? (
            <div className="flex flex-col gap-snug">
              <div className="flex items-center gap-tight">
                <EventGlyph type={selected.type} size={18} />
                <span className="font-mono text-small text-ink-primary">
                  seq {selected.seq} · {selected.type}
                </span>
                <span className="font-mono text-micro text-ink-muted">{selected.ts}</span>
              </div>
              <pre className="max-h-52 overflow-auto rounded-mark bg-base-900 p-snug font-mono text-micro text-ink-secondary">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-small text-ink-muted">Select an event on the track to inspect it.</p>
          )}
        </div>
      </Panel>
    </div>
  )
}
