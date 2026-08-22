/** Backend client. Every path goes through the Vite proxy, so no host is ever hardcoded. */

import type { DhruvaEvent } from '../contracts'

export interface RunSummary {
  run_id: string
  mode: string
  task: string
  scenario: string | null
  twin_id: string | null
  state: string
  events: number
  checkpoints: number
  breaches: number
  rollbacks: number
  learnings: number
  coherence: number | null
  progress: number
}

export interface DhruvaConfig {
  thresholds: { breach: number; warn: number }
  weights: { alignment: number; repetition: number; progress: number }
  models: { agent: string; judge: string; compressor: string }
  live_provider: boolean
}

export interface LedgerEntryView {
  id: string
  kind: string
  text: string
  confidence: number
  status: 'clean' | 'suspect' | 'evicted'
  status_reason: string | null
  minted_at_seq: number
  source_seqs: number[]
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${response.status}`)
  return (await response.json()) as T
}

export const getConfig = () => json<DhruvaConfig>('/api/config')
export const listRuns = () => json<RunSummary[]>('/api/runs')
export const getRun = (id: string) => json<RunSummary>(`/api/runs/${id}`)
export const getLedger = (id: string) => json<LedgerEntryView[]>(`/api/runs/${id}/ledger`)

export const startRun = (body: {
  mode: 'supervised' | 'unsupervised' | 'twin'
  task?: string
  scenario?: string | null
  at_step?: number | null
}) => json<RunSummary & { twin_id?: string }>('/api/runs', { method: 'POST', body: JSON.stringify(body) })

export const armInjection = (id: string, scenario: string, opts: { now?: boolean; at_step?: number } = {}) =>
  json<{ armed: string }>(`/api/runs/${id}/inject`, {
    method: 'POST',
    body: JSON.stringify({ scenario, now: opts.now ?? false, at_step: opts.at_step ?? null }),
  })

/** Parse a JSONL body into events. Used for both replay and the offline mocks. */
export function parseJsonl(text: string): DhruvaEvent[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as DhruvaEvent)
}

export async function getRunEvents(id: string): Promise<DhruvaEvent[]> {
  const response = await fetch(`/api/runs/${id}/events`)
  if (!response.ok) throw new Error(`events ${id} -> ${response.status}`)
  return parseJsonl(await response.text())
}

export async function getMockRun(name: 'happy' | 'breach'): Promise<DhruvaEvent[]> {
  const response = await fetch(`/api/mock/${name}`)
  if (!response.ok) throw new Error(`mock ${name} -> ${response.status}`)
  return parseJsonl(await response.text())
}
