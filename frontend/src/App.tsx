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
import {
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarItem,
  SidebarToggle,
} from './components/shell/Sidebar'
import RaceView, { useRaceClock } from './views/race/RaceView'
import { useRunStream } from './data/useRunStream'
import { usePlayback } from './data/usePlayback'
import {
  armInjection,
  getCanned,
  getConfig,
  getLedger,
  getMockRun,
  getRunEvents,
  listCanned,
  listRuns,
  startRun,
  type CannedRun,
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
  | { kind: 'canned'; name: string }
  | { kind: 'race' }

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

/** Names the beat currently on screen, so a presenter always knows what they are pointing at. */
function beatLabel(shown: readonly DhruvaEvent[]): string {
  const last = shown[shown.length - 1]
  if (!last) return 'ready'
  const seen = new Set(shown.map((e) => e.type))
  if (last.type === 'task_complete') return 'recovered · 12/12'
  if (seen.has('resume') && !seen.has('task_complete')) return 'resumed — finishing the task'
  if (seen.has('ledger_audit')) return 'knowledge audited — clean kept, poisoned evicted'
  if (seen.has('rollback')) return 'rolling back to the last confirmed checkpoint'
  if (seen.has('breach')) return 'breach — drift caught'
  if (shown.some((e) => e.type === 'observation' && (e.payload as { poisoned?: boolean }).poisoned))
    return 'poisoned — the tool lied, and it still looks fine'
  if (seen.has('injection')) return 'corruption injected'
  if (seen.has('checkpoint')) return 'working · checkpoints accruing'
  return 'starting'
}

export default function App() {
  const [config, setConfig] = useState<DhruvaConfig | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [staticEvents, setStaticEvents] = useState<DhruvaEvent[]>([])
  const [ledger, setLedger] = useState<LedgerEntryView[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [canned, setCanned] = useState<CannedRun[]>([])
  const [railOpen, setRailOpen] = useState(true)
  const [scenario, setScenario] = useState<string>('s2')
  const [atStep, setAtStep] = useState(12)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [view, setView] = useState<'timeline' | 'graph'>('timeline')
  const [twin, setTwin] = useState<{ supervised: DhruvaEvent[]; unsupervised: DhruvaEvent[] } | null>(null)
  const [race, setRace] = useState<{ supervised: DhruvaEvent[]; unsupervised: DhruvaEvent[] } | null>(null)

  const liveRunId = source?.kind === 'live' ? source.runId : null
  const stream = useRunStream(liveRunId)

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setError('backend unreachable'))
  }, [])

  // ?demo=1 boots straight into the canned replay. On stage you do not want to be clicking
  // through a UI to reach the thing you are about to talk over.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('demo')) return
    void openRace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    listCanned()
      .then(setCanned)
      .catch(() => undefined)
  }, [])

  // cmd/ctrl B, the binding every editor and shadcn's own sidebar already use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      setRailOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    let failures = 0
    const timer = setInterval(() => {
      getLedger(liveRunId)
        .then((rows) => {
          failures = 0
          setLedger(rows)
        })
        .catch(() => {
          // Give up rather than poll a run that is gone. The registry is in-memory, so a backend
          // restart makes every id in the UI unresolvable, and a silent catch turns that into an
          // endless stream of 404s in the server log.
          if (++failures >= 3) clearInterval(timer)
        })
    }, 1500)
    return () => clearInterval(timer)
  }, [liveRunId, stream.events.length])

  useEffect(() => {
    if (source?.kind !== 'twin') return
    let failures = 0
    let stop = false

    const load = async () => {
      const [a, b] = await Promise.allSettled([
        getRunEvents(source.supervised),
        getRunEvents(source.unsupervised),
      ])
      if (stop) return

      if (a.status === 'rejected' && b.status === 'rejected') {
        // Both gone: almost always a backend restart, since the registry is in-memory. Say so once
        // and stop, rather than emitting a 404 every 1.5s forever.
        if (++failures >= 3) {
          stop = true
          setError('That twin run is no longer available — the backend restarted. Start a new one.')
        }
        return
      }
      failures = 0
      setTwin({
        supervised: a.status === 'fulfilled' ? a.value : [],
        unsupervised: b.status === 'fulfilled' ? b.value : [],
      })
    }

    void load()
    const timer = setInterval(() => {
      if (stop) clearInterval(timer)
      else void load()
    }, 1500)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [source])

  const allEvents = source?.kind === 'live' ? stream.events : staticEvents
  const isCanned = source?.kind === 'canned'
  // What the header pill reports is what you are LOOKING AT, not whether a key is configured.
  const isStatic =
    source?.kind === 'canned' ||
    source?.kind === 'mock' ||
    source?.kind === 'replay' ||
    // The race reads two recorded logs. The pill reports what is on screen, not what a key
    // would allow, so it must not claim a live provider here either.
    source?.kind === 'race'
  const playback = usePlayback(isCanned ? allEvents : [], 60_000)
  const maxSeq = allEvents.length ? allEvents[allEvents.length - 1].seq : 0

  const isRace = source?.kind === 'race'
  const raceMax = race ? Math.max(...race.supervised.map((e) => e.seq)) : 0
  // Hold on the supervised rollback so its four beats can be narrated.
  const raceHolds = useMemo(
    () => (race ? race.supervised.filter((e) => e.type === 'rollback').map((e) => e.seq) : []),
    [race],
  )
  const clock = useRaceClock(raceMax, raceHolds, 75_000)
  const shown = useMemo(() => {
    if (isCanned) return allEvents.slice(0, playback.index + 1)
    return scrub === null ? allEvents : allEvents.filter((e) => e.seq <= scrub)
  }, [allEvents, scrub, isCanned, playback.index])

  // Space plays/pauses, R restarts. A presenter should not be hunting for a button mid-sentence.
  useEffect(() => {
    if (!isCanned) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        playback.toggle()
      } else if (e.key.toLowerCase() === 'r') {
        playback.restart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCanned, playback])

  useEffect(() => {
    if (!isRace) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        // While a rollback beat is held, space advances the beat rather than the clock.
        if (clock.inStage) clock.advanceStage()
        else if (clock.playing) clock.pause()
        else clock.play()
      } else if (e.key.toLowerCase() === 'r') {
        clock.restart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isRace, clock])

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

  async function openRace() {
    setBusy(true)
    setError(null)
    try {
      const [sup, uns] = await Promise.all([
        getCanned('s1-supervised'),
        getCanned('s1-unsupervised'),
      ])
      setRace({ supervised: sup, unsupervised: uns })
      setSource({ kind: 'race' })
    } catch (exc) {
      setError(String(exc))
    } finally {
      setBusy(false)
    }
  }

  async function openCanned(name: string) {
    setBusy(true)
    setError(null)
    try {
      setStaticEvents(await getCanned(name))
      setLedger([])
      setSource({ kind: 'canned', name })
      setScrub(null)
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
  else if (source?.kind === 'canned') label = `replay · ${source.name}`
  else if (source?.kind === 'twin') label = `twin · ${source.supervised}`
  else if (source?.kind === 'race') label = 'supervised vs unsupervised'
  else if (source?.kind === 'live' || source?.kind === 'replay') label = source.runId

  const activeRunId = source && 'runId' in source ? source.runId : null

  return (
    <div className="flex min-h-screen bg-base-900 text-ink-primary">
      <Sidebar open={railOpen}>
        {/* Mirrors the app bar's height, so the rail's first group lines up with main's first row. */}
        <div className="h-15 shrink-0 border-b border-edge-subtle" />

        <SidebarGroup label="recorded">
          {/* The headline demo: both arms of one task on one clock. It reads two recorded logs, so
              it belongs with the recordings rather than with the controls that start new runs. */}
          <SidebarItem active={source?.kind === 'race'} onClick={openRace} disabled={busy}>
            <span className="font-mono text-caption text-ink-primary">
              ▶ supervised vs unsupervised
            </span>
            <span className="font-mono text-micro text-ink-muted">two real runs · one clock</span>
          </SidebarItem>
          {canned.map((c) => (
            <SidebarItem
              key={c.name}
              active={source?.kind === 'canned' && source.name === c.name}
              onClick={() => openCanned(c.name)}
              title="A real log from a real run, replayed through the live render path"
            >
              <span className="font-mono text-caption text-ink-primary">{c.name}</span>
              <span className="font-mono text-micro text-ink-muted tabular-nums">
                {c.events} events · {c.breaches} breach · {Math.round((c.score ?? 0) * 12)}/12
              </span>
            </SidebarItem>
          ))}
          <SidebarItem active={source?.kind === 'mock'} onClick={() => openMock('breach')}>
            <span className="font-mono text-caption text-ink-primary">mock breach</span>
            <span className="font-mono text-micro text-ink-muted">offline fixture</span>
          </SidebarItem>
        </SidebarGroup>

        <SidebarGroup label={`runs · ${runs.length}`}>
          {runs.length === 0 ? (
            <p className="px-tick text-caption text-ink-muted">Nothing yet. Start one below.</p>
          ) : null}
          {runs.map((r) => (
            <SidebarItem
              key={r.run_id}
              active={activeRunId === r.run_id}
              onClick={() => openRun(r)}
              title={`${r.events} events · ${r.checkpoints} checkpoints`}
            >
              <span className="flex w-full items-center gap-tight font-mono text-caption text-ink-primary">
                <span className="truncate">{r.run_id}</span>
                {r.rollbacks ? (
                  <span className="text-alarm-400 tabular-nums">↩ {r.rollbacks}</span>
                ) : null}
                <span className="ml-auto text-ink-muted tabular-nums">
                  {Math.round(r.progress * 12)}/12
                </span>
              </span>
              <span className="flex w-full items-center gap-tight truncate font-mono text-micro text-ink-muted">
                <span>{r.mode}</span>
                {r.twin_id ? <span>twin</span> : null}
                {r.scenario ? <span className="text-state-warn">{r.scenario}</span> : null}
                <span className="truncate">{r.state.replace(/_/g, ' ')}</span>
              </span>
            </SidebarItem>
          ))}
        </SidebarGroup>

        <SidebarFooter>
          <span className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
            next run · scenario
          </span>
          <div className="flex flex-col gap-tick">
            {SCENARIOS.map((sc) => (
              <button
                key={sc.key}
                type="button"
                title={sc.blurb}
                onClick={() => setScenario(sc.key)}
                className={clsx(
                  'rounded-mark border px-snug py-tick text-left font-mono text-micro transition-colors',
                  scenario === sc.key
                    ? 'border-ink-muted bg-base-700 text-ink-primary'
                    : 'border-edge-default text-ink-muted hover:border-edge-strong',
                )}
              >
                {sc.label}
              </button>
            ))}
          </div>

          <label className="flex items-center justify-between gap-tight">
            <span className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
              at step
            </span>
            <input
              type="number"
              min={1}
              value={atStep}
              onChange={(e) => setAtStep(Number(e.target.value))}
              className="w-20 rounded-mark border border-edge-default bg-base-900 px-2 py-1 font-mono text-caption"
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => launch(true)}
            className="rounded-mark border border-ink-primary bg-ink-primary px-snug py-2 font-mono text-micro tracking-[0.14em] text-ink-inverse uppercase transition-colors hover:border-ink-secondary hover:bg-ink-secondary disabled:opacity-40"
          >
            run with scenario
          </button>
          <div className="grid grid-cols-2 gap-tick">
            <button
              type="button"
              disabled={busy}
              onClick={() => launch(false)}
              className="rounded-mark border border-edge-default px-snug py-2 font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase transition-colors hover:border-edge-strong disabled:opacity-40"
            >
              clean run
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={launchTwin}
              className="rounded-mark border border-edge-default px-snug py-2 font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase transition-colors hover:border-edge-strong disabled:opacity-40"
            >
              twin run
            </button>
          </div>
          <button
            type="button"
            disabled={!liveRunId}
            onClick={fireNow}
            className="rounded-mark border border-alarm-400 px-snug py-2 font-mono text-micro tracking-[0.14em] text-alarm-400 uppercase transition-colors hover:bg-alarm-400/10 disabled:opacity-30"
          >
            inject now
          </button>
        </SidebarFooter>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-gutter border-b border-edge-subtle px-panel py-snug">
          <div className="flex items-center gap-3">
            <SidebarToggle open={railOpen} onToggle={() => setRailOpen((open) => !open)} />
            <h1 className="text-title font-semibold tracking-tight">Dhruva</h1>
            <p className="font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
              agent supervisor · flight recorder
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-tight">
            {config ? (
              <>
                <Pill tone={isStatic ? 'idle' : config.live_provider ? 'ok' : 'warn'}>
                  {isStatic ? 'replaying a recorded run' : config.live_provider ? 'live provider' : 'mock provider'}
                </Pill>
                <span className="font-mono text-micro text-ink-muted">
                  agent scripted · judge {config.models.judge}
                </span>
              </>
            ) : (
              <Pill tone="idle">connecting</Pill>
            )}
          </div>
        </header>

        <main className="flex flex-col gap-gutter p-panel">
          {error ? (
            <p className="rounded-panel border border-alarm-400/50 bg-alarm-400/10 px-panel py-snug font-mono text-caption text-alarm-400">
              {error}
            </p>
          ) : null}

          {isCanned && allEvents.length > 0 ? (
            <div className="flex flex-wrap items-center gap-gutter rounded-panel border border-edge-default bg-base-800 px-panel py-snug">
              <button
                type="button"
                onClick={playback.toggle}
                className="rounded-mark border border-edge-default px-4 py-2 font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase transition-colors hover:border-edge-strong"
              >
                {playback.playing ? '❚❚ pause' : '▶ play'}
              </button>
              <button
                type="button"
                onClick={playback.restart}
                className="rounded-mark border border-edge-default px-3 py-2 font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase hover:border-edge-strong"
              >
                ↺ restart
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, allEvents.length - 1)}
                value={playback.index}
                onChange={(e) => playback.seek(Number(e.target.value))}
                className="h-1 min-w-40 flex-1 accent-ink-secondary"
              />
              <span className="font-mono text-micro text-ink-muted">
                {playback.index + 1}/{allEvents.length}
              </span>
              <span className="font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase">
                {beatLabel(shown)}
              </span>
              <span className="font-mono text-micro text-ink-muted">space · R</span>
            </div>
          ) : allEvents.length > 0 ? (
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
                className="h-1 flex-1 accent-ink-secondary"
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

          {source && source.kind !== 'twin' && source.kind !== 'race' ? (
            <div className="flex gap-tight">
              {(['timeline', 'graph'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={clsx(
                    'rounded-mark border px-3 py-1 font-mono text-micro tracking-[0.14em] uppercase',
                    view === v
                      ? 'border-ink-primary text-ink-primary'
                      : 'border-edge-default text-ink-muted hover:border-edge-strong',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          ) : null}

          {isRace && race ? (
            <div className="flex flex-wrap items-center gap-gutter rounded-panel border border-coherence-400/40 bg-base-800 px-panel py-snug">
              <button
                type="button"
                onClick={() => (clock.inStage ? clock.advanceStage() : clock.playing ? clock.pause() : clock.play())}
                className="rounded-mark border border-coherence-400 px-5 py-2 font-mono text-micro tracking-[0.14em] text-coherence-400 uppercase hover:bg-coherence-400/10"
              >
                {clock.inStage ? '→ next beat' : clock.playing ? '❚❚ pause' : '▶ play'}
              </button>
              <button
                type="button"
                onClick={clock.restart}
                className="rounded-mark border border-edge-default px-3 py-2 font-mono text-micro tracking-[0.14em] text-ink-secondary uppercase hover:border-edge-strong"
              >
                ↺ restart
              </button>
              <input
                type="range"
                min={0}
                max={raceMax}
                value={clock.seq}
                onChange={(e) => clock.seek(Number(e.target.value))}
                className="h-1 min-w-40 flex-1 accent-coherence-400"
              />
              <span className="font-mono text-micro text-ink-muted">space · R</span>
            </div>
          ) : null}

          {isRace && race ? (
            <RaceView
              supervised={race.supervised}
              unsupervised={race.unsupervised}
              seq={clock.seq}
              stage={clock.stage}
            />
          ) : source?.kind === 'twin' ? (
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


        </main>
      </div>
    </div>
  )
}
