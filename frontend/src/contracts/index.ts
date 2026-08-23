/**
 * Typed contract surface for the UI.
 *
 * `run_event.ts` / `checkpoint.ts` / `ledger_entry.ts` are GENERATED from the canonical JSON
 * Schemas and are the anchor for envelope shape. This file adds the discriminated payload union
 * that json2ts cannot derive from the schema's `if/then` composition, so views can narrow on
 * `event.type` and get a real payload type instead of `unknown`.
 *
 * `EVENT_TYPES` is asserted against the schema in contracts.test.ts — the two cannot drift.
 */

export type { RunEvent as RunEventRaw, EventType } from './run_event'
export type { Checkpoint, IntentDigest, Snapshot } from './checkpoint'
export type { LedgerEntry } from './ledger_entry'

export const EVENT_TYPES = [
  'task_start',
  'action',
  'observation',
  'memory_op',
  'verification',
  'checkpoint',
  'breach',
  'rollback',
  'resume',
  'injection',
  'task_complete',
  'learning',
  'ledger_audit',
  'swarm_checkpoint',
  'swarm_verification',
  'bulletin',
  'quarantine',
] as const

export type DhruvaEventType = (typeof EVENT_TYPES)[number]
export type Verdict = 'pass' | 'warn' | 'breach'
export type Scenario = 's1' | 's2' | 's3'
export type LearningKind = 'fact' | 'constraint' | 'failed_approach' | 'resource' | 'api_shape'
export type SeqRange = [number, number]

/** v3/D2 — progress is a record, not a float: S3's corruption is an edit to the test suite. */
export interface ProgressResult {
  score: number
  per_test: Record<string, 'pass' | 'fail'>
  tests_tampered: boolean
}

export interface TaskStartPayload {
  task: string
  mode: 'supervised' | 'unsupervised'
  spec_hash: string
  seeded_learnings?: number
}
export interface ActionPayload {
  step: number
  description: string
  tool: string
  args_digest: string
  /** v3/D3 — forces a verification window so a falsely-satisfied agent cannot end in silence. */
  claims_complete?: boolean
}
export interface ObservationPayload {
  tool: string
  result_digest: string
  /** Fixture ground truth. The taint audit keys on this — never inferred. */
  poisoned: boolean
  /** What is ACTUALLY true — measured by the supervisor, not reported by the tool. */
  progress?: ProgressResult
  /** What the agent saw, verbatim. Without it the lie is unrecoverable from the log. */
  content?: string | null
  /** What the agent concludes. Diverges from `progress` exactly when the tool lied. */
  agent_progress?: ProgressResult
}
export interface MemoryOpPayload {
  op: 'read' | 'write' | 'compact'
  detail: string
}
export interface VerificationPayload {
  window: SeqRange
  alignment: number
  repetition: number
  progress: number
  /** C = 0.6*alignment + 0.2*repetition + 0.2*progress */
  coherence: number
  verdict: Verdict
  rationale: string
  violated_constraints?: string[]
  tests_tampered?: boolean
}
export interface CheckpointPayload {
  id: string
  seq_range: SeqRange
  parent_hash: string
  hash: string
  /** v3 — only confirmed checkpoints are valid rollback targets. */
  confirmed?: boolean
  ledger_head?: string | null
}
export interface BreachPayload {
  verification_ref: number
  rule_fired:
    | 'below_breach_threshold'
    | 'two_consecutive_warns'
    | 'tests_tampered'
    | 'preflight_failed'
}
export interface RollbackPayload {
  from_seq: number
  target_checkpoint_id: string
  discarded_range: SeqRange
  ledger_audit_ref?: number | null
}
export interface ResumePayload {
  preflight_verification_ref: number
  retained_learnings?: number
}
export interface InjectionPayload {
  scenario: Scenario
  at_step: number
  target_agent?: string | null
}
export interface TaskCompletePayload {
  success: boolean
  progress: ProgressResult
  steps?: number
}
export interface LearningPayload {
  entry_id: string
  kind: LearningKind
  text: string
  confidence: number
  source_seqs: number[]
  supersedes?: string | null
}
export interface EvictedEntry {
  entry_id: string
  reason: 'poisoned_source' | 'post_injection_window' | 'superseded_evicted' | 'cites_evicted'
  taint_score: number
}
/** Exactly one per rollback — the retained/evicted split is criterion 10's evidence. */
export interface LedgerAuditPayload {
  rollback_ref: number
  retained: string[]
  evicted: EvictedEntry[]
}
export interface QuarantinePayload {
  entry_id: string
  reason: 'window_breached' | 'contested' | 'contaminated'
  blocked_from?: string[]
}

interface Envelope {
  run_id: string
  seq: number
  ts: string
  checkpoint_ref?: string | null
  agent_id?: string | null
  swarm_id?: string | null
}

type Ev<T extends DhruvaEventType, P> = Envelope & { type: T; payload: P }

/** Narrow on `.type` to get the payload type. */
export type DhruvaEvent =
  | Ev<'task_start', TaskStartPayload>
  | Ev<'action', ActionPayload>
  | Ev<'observation', ObservationPayload>
  | Ev<'memory_op', MemoryOpPayload>
  | Ev<'verification', VerificationPayload>
  | Ev<'checkpoint', CheckpointPayload>
  | Ev<'breach', BreachPayload>
  | Ev<'rollback', RollbackPayload>
  | Ev<'resume', ResumePayload>
  | Ev<'injection', InjectionPayload>
  | Ev<'task_complete', TaskCompletePayload>
  | Ev<'learning', LearningPayload>
  | Ev<'ledger_audit', LedgerAuditPayload>
  | Ev<'quarantine', QuarantinePayload>
  | Ev<'swarm_checkpoint', Record<string, unknown>>
  | Ev<'swarm_verification', Record<string, unknown>>
  | Ev<'bulletin', Record<string, unknown>>

export const isEvent =
  <T extends DhruvaEvent['type']>(type: T) =>
  (e: DhruvaEvent): e is Extract<DhruvaEvent, { type: T }> =>
    e.type === type

/** Parse one JSONL line. Throws on malformed JSON; shape is guaranteed by the backend schema. */
export function parseEventLine(line: string): DhruvaEvent {
  return JSON.parse(line) as DhruvaEvent
}
