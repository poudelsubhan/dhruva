/**
 * Dhruva — the flight recorder shell.
 *
 * Three sources feed one render path: a live WebSocket, a replayed JSONL log, and the offline mock
 * fixtures. Only the source differs; the view is identical, which is what makes replay a real
 * replay rather than a second renderer that can drift.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import LiveView from './views/live/LiveView'
import TwinView from './views/twin/TwinView'
import GraphView from './views/graph/GraphView'
import { useRunStream } from './data/useRunStream'
import {
  armInjection,
  getConfig,
  getLedger,
  getMockRun,
  getRunEvents,
  listRuns,
  startRun,
  type DhruvaConfig,
  type LedgerEntryView,
  type RunSummary,
} from './data/api'
import type { DhruvaEvent } from './contracts'

type Source =
  | { kind: 'live'; runId: string }
  | { kind: 'replay'; runId: string }
  | { kind: 'mock'; name: 'happy' | 'breach' }
  | { kind: 'twin'; supervised: string; unsupervised: string }

const SCENARIOS: { key: string; label: string; blurb: string }[] = [
  { key: 's1', label: 'S1 · contradictory instruction', blurb: 'a plausible redirect that supersedes the objective' },
  { key: 's2', label: 'S2 · poisoned tool output', blurb: 'a falsified test result it has no way to distrust' },
  { key: 's3', label: 'S3 · compaction loss', blurb: 'a lossy summary that drops one critical constraint' },
]

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'idle'; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        'rounded-pill border px-3 py-1 font-mono text-micro tracking-[0.14em] uppercase',
        tone === 'ok' && 'border-state-pass/60 text-state-pass',
        tone === 'warn' && 'border-state-warn/60 text-state-warn',
        tone === 'idle' && 'border-edge-default text-ink-muted',
      )}
    >
      {children}
    </span>
  )
}

export default function App() {
  const [config, setConfig] = useState<DhruvaConfig | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [staticEvents, setStaticEvents] = useState<DhruvaEvent[]>([])
  const [ledger, setLedger] = useState<LedgerEntryView[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [scenario, setScenario] = useState<string>('s2')
  const [atStep, setAtStep] = useState(12)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [view, setView] = useState<'timeline' | 'graph'>('timeline')
  const [twin, setTwin] = useState<{ supervised: DhruvaEvent[]; unsupervised: DhruvaEvent[] } | null>(null)

  const liveRunId = source?.kind === 'live' ? source.runId : null
  const stream = useRunStream(liveRunId)

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setError('backend unreachable'))
  }, [])

  const refreshRuns = useCallback(() => {
    listRuns().then(setRuns).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshRuns()
    const timer = setInterval(refreshRuns, 2000)
    return () => clearInterval(timer)
  }, [refreshRuns])

  // Pull the ledger alongside the stream so eviction state is visible, not just the mint events.
  useEffect(() => {
    if (!liveRunId) return
    const load = () => getLedger(liveRunId).then(setLedger).catch(() => undefined)
    load()
    const timer = setInterval(load, 1500)
    return () => clearInterval(timer)
  }, [liveRunId, stream.events.length])

  useEffect(() => {
    if (source?.kind !== 'twin') return
    const load = async () => {
      const [a, b] = await Promise.all([
        getRunEvents(source.supervised).catch(() => []),
        getRunEvents(source.unsupervised).catch(() => []),
      ])
      setTwin({ supervised: a, unsupervised: b })
    }
    load()
    const timer = setInterval(load, 1500)
    return () => clearInterval(timer)
  }, [source])

  const allEvents = source?.kind === 'live' ? stream.events : staticEvents
  const maxSeq = allEvents.length ? allEvents[allEvents.length - 1].seq : 0
  const shown = useMemo(
    () => (scrub === null ? allEvents : allEvents.filter((e) => e.seq <= scrub)),
    [allEvents, scrub],
  )

  async function launch(withScenario: boolean) {
    setBusy(true)
    setError(null)
    setScrub(null)
    setLedger([])
    try {
      const run = await startRun({
        mode: 'supervised',
        task: 'loglens',
        scenario: withScenario ? scenario : null,
        at_step: withScenario ? atStep : null,
      })
      setSource({ kind: 'live', runId: run.run_id })
      refreshRuns()
    } catch (exc) {
      setError(String(exc))
    } finally {
      setBusy(false)
    }
  }

  async function openRun(run: RunSummary) {
    // A twin is a pair, so opening either member must restore the comparison rather than a single
    // track. Without this a completed twin is unreachable once the page reloads.
    if (run.twin_id) {
      const pair = runs.filter((r) => r.twin_id === run.twin_id)
      const sup = pair.find((r) => r.mode === 'supervised')
      const uns = pair.find((r) => r.mode === 'unsupervised')
      if (sup && uns) {
        setSource({ kind: 'twin', supervised: sup.run_id, unsupervised: uns.run_id })
        setTwin({ supervised: [], unsupervised: [] })
        return
      }
    }
    return openReplay(run.run_id)
  }

  async function openReplay(runId: string) {
    setBusy(true)
    try {
      const events = await getRunEvents(runId)
      setStaticEvents(events)
      setLedger(await getLedger(runId).catch(() => []))
      setSource({ kind: 'replay', runId })
      setScrub(null)
    } catch (exc) {
      setError(String(exc))
    } finally {
      setBusy(false)
    }
  }

  async function launchTwin() {
    setBusy(true)
    setError(null)
    try {
      const pair = (await startRun({
        mode: 'twin',
        task: 'loglens',
        scenario,
        at_step: atStep,
      })) as unknown as { supervised: string; unsupervised: string }
      setSource({ kind: 'twin', supervised: pair.supervised, unsupervised: pair.unsupervised })
      setTwin({ supervised: [], unsupervised: [] })
      refreshRuns()
    } catch (exc) {
      setError(String(exc))
    } finally {
      setBusy(false)
    }
  }

  async function openMock(name: 'happy' | 'breach') {
    setBusy(true)
    try {
      setStaticEvents(await getMockRun(name))
      setLedger([])
      setSource({ kind: 'mock', name })
      setScrub(null)
    } catch (exc) {
      setError(String(exc))
    } finally {
      setBusy(false)
    }
  }

  async function fireNow() {
    if (!liveRunId) return
    await armInjection(liveRunId, scenario, { now: true }).catch((exc: unknown) => setError(String(exc)))
  }

  let label = 'no run'
  if (source?.kind === 'mock') label = `mock · ${source.name}`
  else if (source?.kind === 'twin') label = `twin · ${source.supervised}`
  else if (source) label = source.runId

  return (
    <div className="min-h-screen bg-base-900 text-ink-primary">
      <header className="flex flex-wrap items-center justify-between gap-gutter border-b border-edge-subtle px-panel py-snug">
        <div className="flex items-baseline gap-3">
          <h1 className="text-h3 font-semibold tracking-tight">Dhruva</h1>
          <p className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
            agent supervisor · flight recorder
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-tight">
          {config ? (
            <>
              <Pill tone={config.live_provider ? 'ok' : 'warn'}>
                {config.live_provider ? 'live provider' : 'mock provider'}
              </Pill>
              <span className="font-mono text-micro text-ink-muted">
                agent {config.models.agent} · judge {config.models.judge}
              </span>
            </>
          ) : (
            <Pill tone="idle">connecting</Pill>
          )}
        </div>
      </header>

      <main className="flex flex-col gap-gutter p-panel">
        <section className="flex flex-wrap items-end gap-gutter rounded-panel border border-edge-default bg-base-800 p-panel">
          <div className="flex flex-col gap-tight">
            <span className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
              scenario
            </span>
            <div className="flex flex-wrap gap-tight">
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  title={s.blurb}
                  onClick={() => setScenario(s.key)}
                  className={clsx(
                    'rounded-mark border px-3 py-2 text-left font-mono text-micro transition-colors',
                    scenario === s.key
                      ? 'border-coherence-400 text-ink-primary'
                      : 'border-edge-default text-ink-muted hover:border-edge-strong',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-tight">
            <span className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
              at step
            </span>
            <input
              type="number"
              min={1}
              value={atStep}
              onChange={(e) => setAtStep(Number(e.target.value))}
              className="w-20 rounded-mark border border-edge-default bg-base-900 px-2 py-2 font-mono text-small"
            />
          </label>

          <div className="flex flex-wrap gap-tight">
            <button
              type="button"
              disabled={busy}
              onClick={() => launch(true)}
              className="rounded-mark border border-coherence-400 px-4 py-2 font-mono text-micro tracking-[0.14em] text-coherence-400 uppercase transition-colors hover:bg-coherence-400/10 disabled:opacity-40"
            >
              run with scenario
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => launch(false)}
              className="rounded-mark border border-edge-default px-4 py-2 font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase transition-colors hover:border-edge-strong disabled:opacity-40"
            >
              clean run
            </button>
            <button
              type="button"
              disabled={!liveRunId}
              onClick={fireNow}
              className="rounded-mark border border-alarm-400 px-4 py-2 font-mono text-micro tracking-[0.14em] text-alarm-400 uppercase transition-colors hover:bg-alarm-400/10 disabled:opacity-30"
            >
              inject now
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={launchTwin}
              className="rounded-mark border border-edge-default px-4 py-2 font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase transition-colors hover:border-edge-strong disabled:opacity-40"
            >
              twin run
            </button>
            <button
              type="button"
              onClick={() => openMock('breach')}
              className="rounded-mark border border-edge-default px-4 py-2 font-mono text-micro tracking-[0.14em] text-ink-muted uppercase hover:border-edge-strong"
            >
              mock breach
            </button>
          </div>
        </section>

        {error ? (
          <p className="rounded-panel border border-alarm-400/50 bg-alarm-400/10 px-panel py-snug font-mono text-small text-alarm-400">
            {error}
          </p>
        ) : null}

        {allEvents.length > 0 ? (
          <div className="flex items-center gap-gutter rounded-panel border border-edge-default bg-base-800 px-panel py-snug">
            <span className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
              scrub
            </span>
            <input
              type="range"
              min={0}
              max={maxSeq}
              value={scrub ?? maxSeq}
              onChange={(e) => setScrub(Number(e.target.value))}
              className="h-1 flex-1 accent-coherence-400"
            />
            <span className="w-24 text-right font-mono text-micro text-ink-muted">
              seq {scrub ?? maxSeq}/{maxSeq}
            </span>
            <button
              type="button"
              onClick={() => setScrub(null)}
              className="font-mono text-micro text-ink-muted underline-offset-2 hover:underline"
            >
              live
            </button>
          </div>
        ) : null}

        {source && source.kind !== 'twin' ? (
          <div className="flex gap-tight">
            {(['timeline', 'graph'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={clsx(
                  'rounded-mark border px-3 py-1 font-mono text-micro tracking-[0.14em] uppercase',
                  view === v
                    ? 'border-coherence-400 text-coherence-400'
                    : 'border-edge-default text-ink-muted hover:border-edge-strong',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        ) : null}

        {source?.kind === 'twin' ? (
          <TwinView
            supervised={twin?.supervised ?? []}
            unsupervised={twin?.unsupervised ?? []}
          />
        ) : source && view === 'graph' ? (
          <GraphView events={shown} />
        ) : source ? (
          <LiveView
            events={shown}
            config={config}
            ledger={ledger}
            connected={source.kind === 'live' && stream.connected}
            label={label}
            playhead={scrub}
          />
        ) : (
          <p className="rounded-panel border border-edge-default bg-base-800 px-panel py-12 text-center text-ink-muted">
            Start a run, or open the mock breach log.
          </p>
        )}

        {runs.length > 0 ? (
          <section className="rounded-panel border border-edge-default bg-base-800 p-panel">
            <h2 className="mb-snug font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
              runs
            </h2>
            <div className="flex flex-col gap-tight">
              {runs.map((r) => (
                <button
                  key={r.run_id}
                  type="button"
                  onClick={() => openRun(r)}
                  className="flex flex-wrap items-center gap-gutter rounded-mark border border-edge-subtle px-3 py-2 text-left font-mono text-micro text-ink-secondary hover:border-edge-strong"
                >
                  <span className="text-ink-primary">{r.run_id}</span>
                  <span>{r.mode}</span>
                  {r.twin_id ? <span className="text-coherence-400">twin</span> : null}
                  {r.scenario ? <span className="text-state-warn">{r.scenario}</span> : null}
                  <span>{r.state}</span>
                  <span>{r.events} events</span>
                  <span>{r.checkpoints} ckpt</span>
                  {r.rollbacks ? <span className="text-alarm-400">{r.rollbacks} rollback</span> : null}
                  <span>{Math.round(r.progress * 12)}/12</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
