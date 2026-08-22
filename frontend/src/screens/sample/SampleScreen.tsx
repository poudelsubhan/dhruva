import { useState, type ReactNode } from 'react'

import {
  CheckpointDiamond,
  CoherenceGauge,
  EVENT_GLYPH_SHAPES,
  EVENT_LABELS,
  EVENT_TYPES,
  EventGlyph,
  Panel,
  TimelineTrack,
  verdictFor,
  DEFAULT_THRESHOLDS,
} from '../../components/core'
import {
  SAMPLE_ARCS,
  SAMPLE_CHECKPOINTS,
  SAMPLE_COHERENCE,
  SAMPLE_RUN,
  type RunEvent,
  type VerificationPayload,
} from './fixture'

/**
 * The composition proof for T1.2: one screen, all five core components, one
 * synthetic run. Static — no transport, no store. If these five compose here,
 * the five Phase 2 views can be built against them without coordination.
 */

const LATEST_COHERENCE = SAMPLE_COHERENCE[SAMPLE_COHERENCE.length - 1]

function Chip({ children, tone }: { children: ReactNode; tone: 'quiet' | 'warn' | 'alarm' }) {
  const toneClass =
    tone === 'alarm'
      ? 'border-alarm-400 text-alarm-400'
      : tone === 'warn'
        ? 'border-state-warn text-state-warn'
        : 'border-edge-strong text-ink-secondary'

  return (
    <span
      className={`inline-flex items-center gap-tick rounded-pill border-2 px-snug py-tick font-mono text-micro font-semibold tracking-[0.16em] uppercase ${toneClass}`}
    >
      {children}
    </span>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-tick">
      <span className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="text-body text-ink-primary">{value}</span>
    </div>
  )
}

function Inspector({ event }: { event: RunEvent | null }) {
  if (!event) {
    return (
      <p className="text-body text-ink-muted">
        Select an event on the track to inspect its payload.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-gutter">
      <div className="flex items-center gap-snug">
        <EventGlyph
          type={event.type}
          size={28}
          poisoned={Boolean((event.payload as { poisoned?: boolean }).poisoned)}
        />
        <div className="flex flex-col">
          <span className="text-lead font-semibold text-ink-primary">
            {EVENT_LABELS[event.type]}
          </span>
          <span className="font-mono text-micro tracking-widest text-ink-muted uppercase tabular-nums">
            seq {event.seq} · {event.ts.slice(11, 19)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-gutter">
        <Field label="run" value={<span className="font-mono text-caption">{event.run_id}</span>} />
        <Field
          label="checkpoint ref"
          value={
            <span className="font-mono text-caption">{event.checkpoint_ref ?? '—'}</span>
          }
        />
      </div>
      <pre className="max-h-40 overflow-auto rounded-control border-2 border-edge-subtle bg-base-950 p-snug font-mono text-caption leading-relaxed text-ink-secondary">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
    </div>
  )
}

export function SampleScreen() {
  const [selected, setSelected] = useState<RunEvent | null>(null)
  const [pinnedCheckpoint, setPinnedCheckpoint] = useState<string | null>(null)

  const verdict = verdictFor(LATEST_COHERENCE, DEFAULT_THRESHOLDS)
  const breachEvent = SAMPLE_RUN.find((event) => event.type === 'breach')
  const lastVerification = [...SAMPLE_RUN]
    .reverse()
    .find((event) => event.type === 'verification')
  const rationale = lastVerification
    ? (lastVerification.payload as VerificationPayload).rationale
    : ''

  return (
    <div className="flex min-h-screen flex-col gap-bay bg-base-900 p-bay">
      <div className="grid gap-bay lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Timeline · run_sample_a1"
          status={
            <>
              <Chip tone="quiet">41 events</Chip>
              {breachEvent ? <Chip tone="alarm">1 breach</Chip> : null}
            </>
          }
          className="min-h-[15rem]"
        >
          <TimelineTrack
            events={SAMPLE_RUN}
            arcs={SAMPLE_ARCS}
            playhead={41}
            onSelect={setSelected}
            height={150}
          />
          <p className="mt-gutter text-caption text-ink-muted">
            The arc is the rollback: breach at seq 29, discarding seq 17–29, back to ckpt-02 at
            seq 16. It is drawn in the one red this system owns.
          </p>
        </Panel>

        <Panel
          title="Coherence"
          status={
            <Chip tone={verdict === 'breach' ? 'alarm' : verdict === 'warn' ? 'warn' : 'quiet'}>
              {verdict}
            </Chip>
          }
        >
          <CoherenceGauge coherence={LATEST_COHERENCE} sparkline={SAMPLE_COHERENCE} size={200} />
          <p className="mt-gutter text-caption leading-relaxed text-ink-secondary">{rationale}</p>
        </Panel>
      </div>

      <div className="grid gap-bay lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Checkpoint chain"
          status={<Chip tone="quiet">{SAMPLE_CHECKPOINTS.length} verified</Chip>}
        >
          <div className="flex flex-wrap items-center gap-gutter">
            {SAMPLE_CHECKPOINTS.map((checkpoint) => (
              <CheckpointDiamond
                key={checkpoint.checkpointId}
                checkpointId={checkpoint.checkpointId}
                verified={checkpoint.verified}
                seq={checkpoint.seq}
                onClick={setPinnedCheckpoint}
              />
            ))}
            <CheckpointDiamond checkpointId="ckpt-04-pending" verified={false} seq={48} />
          </div>
          <p className="mt-gutter font-mono text-caption text-ink-muted">
            {pinnedCheckpoint ? `pinned: ${pinnedCheckpoint}` : 'click a checkpoint to pin it'}
          </p>
        </Panel>

        <Panel title="Event inspector" status={<Chip tone="quiet">payload</Chip>}>
          <Inspector event={selected} />
        </Panel>
      </div>

      <Panel title="Glyph index · 17 event types" status={<Chip tone="quiet">shape = identity</Chip>}>
        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {EVENT_TYPES.map((type) => (
            <div key={type} className="flex items-start gap-snug">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-mark bg-base-700">
                <EventGlyph type={type} size={22} />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-caption font-semibold text-ink-primary">
                  {type}
                </span>
                <span className="text-micro leading-snug text-ink-muted">
                  {EVENT_GLYPH_SHAPES[type]}
                </span>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-snug">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-mark bg-base-700">
              <EventGlyph type="observation" size={22} poisoned />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="font-mono text-caption font-semibold text-ink-primary">
                poisoned
              </span>
              <span className="text-micro leading-snug text-ink-muted">
                any glyph, struck through and tinted warn
              </span>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
