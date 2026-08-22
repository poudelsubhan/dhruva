/* GENERATED from shared/schema/run_event.schema.json — do not edit. Regenerate: npm run contracts */

/**
 * One entry in a run's append-only event log. The WebSocket frame and the JSONL line on disk carry byte-identical objects — a single source of truth for live and replay.
 */
export type RunEvent = {
  [k: string]: unknown;
} & {
  run_id: string;
  /**
   * Monotonic per run, assigned solely by the RunController. Gapless: the UI renders only a contiguous prefix.
   */
  seq: number;
  ts: string;
  type: EventType;
  payload: {
    [k: string]: unknown;
  };
  /**
   * Id of the checkpoint this event falls under, or null before the first checkpoint.
   */
  checkpoint_ref?: string | null;
  /**
   * Reserved (v3). Null for every single-agent run. Non-null only in a projected swarm log.
   */
  agent_id?: string | null;
  /**
   * Reserved (v3). Links the members of one swarm.
   */
  swarm_id?: string | null;
};
export type EventType =
  | "task_start"
  | "action"
  | "observation"
  | "memory_op"
  | "verification"
  | "checkpoint"
  | "breach"
  | "rollback"
  | "resume"
  | "injection"
  | "task_complete"
  | "learning"
  | "ledger_audit"
  | "swarm_checkpoint"
  | "swarm_verification"
  | "bulletin"
  | "quarantine";
