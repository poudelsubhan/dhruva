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

  it('reports the provider and both model ids once config loads', async () => {
    render(<App />)
    expect(await screen.findByText(/live provider/i)).toBeInTheDocument()
    // Mixed-provider is a property worth showing, not just asserting in a test.
    expect(screen.getByText(/claude-sonnet-5/)).toBeInTheDocument()
    expect(screen.getByText(/gpt-5-mini/)).toBeInTheDocument()
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
