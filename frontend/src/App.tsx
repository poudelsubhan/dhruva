import { useEffect, useState } from 'react'
import { fetchHealth, type HealthResponse } from './lib/health'
import { SampleScreen } from './screens/sample/SampleScreen'

const POLL_MS = 3000

type ConnectionState = 'connecting' | 'connected' | 'disconnected'

type HealthState = {
  state: ConnectionState
  health: HealthResponse | null
}

function useHealth(): HealthState {
  const [state, setState] = useState<ConnectionState>('connecting')
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function poll() {
      try {
        const result = await fetchHealth(controller.signal)
        if (cancelled) return
        setHealth(result)
        setState('connected')
      } catch {
        if (cancelled) return
        setHealth(null)
        setState('disconnected')
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  return { state, health }
}

const DOT_CLASS: Record<ConnectionState, string> = {
  connecting: 'bg-zinc-500 animate-pulse',
  connected: 'bg-zinc-200',
  disconnected: 'bg-zinc-600',
}

const PILL_CLASS: Record<ConnectionState, string> = {
  connecting: 'border-zinc-700 text-zinc-400',
  connected: 'border-zinc-500 text-zinc-100',
  disconnected: 'border-zinc-800 text-zinc-500',
}

function StatusPill({ state, health }: HealthState) {
  let detail = 'waiting for backend on :8000'
  if (state === 'connected') {
    detail = `v${health?.version ?? 'unknown'}`
  } else if (state === 'disconnected') {
    detail = `retrying every ${POLL_MS / 1000}s`
  }

  return (
    <div
      className={`inline-flex items-center gap-3 rounded-full border px-4 py-2 font-mono text-sm ${PILL_CLASS[state]}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${DOT_CLASS[state]}`}
        aria-hidden="true"
      />
      <span>{state}</span>
      <span className="text-zinc-500">{detail}</span>
    </div>
  )
}

type View = 'shell' | 'sample'

/** Dev toggle between the Phase 0 shell and T1.2's composed sample screen. */
function ViewToggle({ view, onChange }: { view: View; onChange: (next: View) => void }) {
  const options: Array<[View, string]> = [
    ['shell', 'shell'],
    ['sample', 'sample'],
  ]

  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex items-center gap-hair rounded-pill border border-edge-default bg-base-800 p-hair"
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={view === value}
          className={`rounded-pill px-snug py-tick font-mono text-micro tracking-[0.16em] uppercase ${
            view === value
              ? 'bg-base-500 text-ink-primary'
              : 'text-ink-muted hover:text-ink-secondary'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const { state, health } = useHealth()
  const [view, setView] = useState<View>('shell')

  if (view === 'sample') {
    return (
      <div className="min-h-screen w-full bg-base-900">
        <header className="flex flex-wrap items-center justify-between gap-gutter border-b border-edge-default bg-base-950 px-bay py-gutter">
          <div className="flex items-baseline gap-snug">
            <span className="text-title font-semibold tracking-tight text-ink-primary">
              Dhruva
            </span>
            <span className="font-mono text-micro tracking-[0.2em] text-ink-muted uppercase">
              flight recorder · visual contract
            </span>
          </div>
          <div className="flex items-center gap-gutter">
            <StatusPill state={state} health={health} />
            <ViewToggle view={view} onChange={setView} />
          </div>
        </header>
        <SampleScreen />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col justify-between bg-zinc-950 px-8 py-10 text-zinc-100">
      <header className="flex items-center justify-between gap-6 font-mono text-xs tracking-widest text-zinc-600 uppercase">
        <span>phase 0 — scaffold</span>
        <ViewToggle view={view} onChange={setView} />
      </header>

      <main className="flex flex-col items-start gap-6">
        <h1 className="text-6xl font-semibold tracking-tight">Dhruva</h1>
        <p className="text-lg text-zinc-400">
          agent supervisor — flight recorder
        </p>
        <StatusPill state={state} health={health} />
      </main>

      <footer className="font-mono text-xs text-zinc-600">
        <span>build mode: {import.meta.env.MODE}</span>
        {health ? <span> · service: {health.service}</span> : null}
      </footer>
    </div>
  )
}
