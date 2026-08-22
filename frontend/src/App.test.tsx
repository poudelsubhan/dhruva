import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const CONFIG = {
  thresholds: { breach: 0.55, warn: 0.7 },
  weights: { alignment: 0.6, repetition: 0.2, progress: 0.2 },
  models: { agent: 'anthropic/claude-sonnet-5', judge: 'openai/gpt-5-mini', compressor: 'x' },
  live_provider: true,
}

const MOCK_JSONL = [
  { run_id: 'm', seq: 0, ts: 't', type: 'task_start', payload: { task: 'loglens', mode: 'supervised', spec_hash: 'a' } },
  { run_id: 'm', seq: 1, ts: 't', type: 'action', payload: { step: 1, description: 'read', tool: 'read_file', args_digest: 'd' } },
  {
    run_id: 'm', seq: 2, ts: 't', type: 'verification',
    payload: { window: [0, 1], alignment: 0.9, repetition: 1, progress: 1, coherence: 0.94, verdict: 'pass', rationale: 'ok' },
  },
]
  .map((e) => JSON.stringify(e))
  .join('\n')

function mockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/config')) return new Response(JSON.stringify(CONFIG))
    if (url.includes('/api/runs') && !url.includes('/events')) return new Response(JSON.stringify([]))
    if (url.includes('/api/mock/')) return new Response(MOCK_JSONL)
    const custom = Object.entries(overrides).find(([key]) => url.includes(key))
    if (custom) return new Response(JSON.stringify(custom[1]))
    return new Response('[]')
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch())
  vi.stubGlobal(
    'WebSocket',
    class {
      onopen: (() => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((e: { data: string }) => void) | null = null
      close() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App shell', () => {
  it('renders the wordmark and role', () => {
    render(<App />)
    expect(screen.getByText('Dhruva')).toBeInTheDocument()
    expect(screen.getByText(/flight recorder/i)).toBeInTheDocument()
  })

  it('names the judge model and does not claim the agent is a live one', async () => {
    render(<App />)
    expect(await screen.findByText(/live provider/i)).toBeInTheDocument()
    expect(screen.getByText(/gpt-5-mini/)).toBeInTheDocument()
    // The agent is a scripted adapter -- that is what makes the demo deterministic. The header
    // said `agent anthropic/claude-sonnet-5`, which was the one false claim on the screen.
    expect(screen.getByText(/agent scripted/)).toBeInTheDocument()
    expect(screen.queryByText(/claude-sonnet-5/)).not.toBeInTheDocument()
  })

  it('surfaces an unreachable backend rather than rendering empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    render(<App />)
    expect(await screen.findByText(/backend unreachable/i)).toBeInTheDocument()
  })

  it('offers all three corruption scenarios', () => {
    render(<App />)
    expect(screen.getByText(/contradictory instruction/i)).toBeInTheDocument()
    expect(screen.getByText(/poisoned tool output/i)).toBeInTheDocument()
    expect(screen.getByText(/compaction loss/i)).toBeInTheDocument()
  })

  it('loads the mock log and renders it through the live view', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /mock breach/i }))
    // "timeline" now also names a view toggle, so assert on the panel's own heading.
    await waitFor(() => expect(screen.getByText(/timeline · mock/i)).toBeInTheDocument())
    expect(screen.getByText(/3 events/)).toBeInTheDocument()
  })

  it('offers a graph view alongside the timeline once a run is open', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /mock breach/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'graph' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'graph' }))
    expect(screen.getByRole('img', { name: /provenance graph/i })).toBeInTheDocument()
  })

  it('disables "inject now" until a live run exists', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /inject now/i })).toBeDisabled()
  })
})

describe('demo replay', () => {
  const CANNED = [
    { run_id: 'c', seq: 0, ts: 't', type: 'task_start', payload: { task: 'loglens', mode: 'supervised', spec_hash: 'a' } },
    { run_id: 'c', seq: 1, ts: 't', type: 'injection', payload: { scenario: 's1', at_step: 12 } },
    { run_id: 'c', seq: 2, ts: 't', type: 'breach', payload: { verification_ref: 1, rule_fired: 'below_breach_threshold' } },
    { run_id: 'c', seq: 3, ts: 't', type: 'rollback', payload: { from_seq: 2, target_checkpoint_id: 'ckpt-01', discarded_range: [1, 2] } },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n')

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/config')) return new Response(JSON.stringify(CONFIG))
        if (url.includes('/api/canned/')) return new Response(CANNED)
        if (url.includes('/api/runs')) return new Response(JSON.stringify([]))
        return new Response('[]')
      }),
    )
  })

  it('loads the canned run and shows presenter controls', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /demo replay/i }))
    // Presenter controls, not a scrub bar: on stage you press play, not drag.
    expect(await screen.findByRole('button', { name: '▶ play' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument()
  })

  it('starts paused at the first event so nothing runs before you are ready', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /demo replay/i }))
    expect(await screen.findByText('1/4')).toBeInTheDocument()
  })

  it('names the beat on screen so the presenter can narrate it', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /demo replay/i }))
    expect(await screen.findByText(/starting/i)).toBeInTheDocument()
  })
})
