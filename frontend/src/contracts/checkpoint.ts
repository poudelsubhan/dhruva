/* GENERATED from shared/schema/checkpoint.schema.json — do not edit. Regenerate: npm run contracts */

/**
 * A last-known-good state. Minted only after a passing verification, so checkpoints are verified-coherent by construction.
 */
export interface Checkpoint {
  id: string;
  run_id: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  seq_range: [number, number];
  intent_digest: IntentDigest;
  snapshot: Snapshot;
  /**
   * Genesis is sha256(task_spec).
   */
  parent_hash: string;
  /**
   * sha256(parent_hash + canonical_json(intent_digest) + canonical_json(snapshot.file_hashes) + str(seq_range)). Canonical JSON = sorted keys, no whitespace, UTF-8. ledger_head is deliberately NOT an input.
   */
  hash: string;
  verified: true;
  /**
   * v3: true once the window AFTER this checkpoint also verdicts pass. Only confirmed checkpoints are valid rollback targets. Two reasons: (a) without it the discarded range holds only warn/breach windows, which admitted no learnings, making the non-amnesic mechanism a no-op; (b) it prevents restoring a snapshot minted after the injection landed.
   */
  confirmed?: boolean;
  /**
   * Ledger admission-chain head at mint time. A plain reference — NOT hashed, because entry status mutates and would otherwise invalidate every downstream checkpoint on the first eviction.
   */
  ledger_head?: string | null;
}
/**
 * <=200 tokens total. This is what is rendered as the authoritative objective block on rollback, and it is on the projector during the demo — keep it clean.
 */
export interface IntentDigest {
  /**
   * One sentence.
   */
  objective: string;
  /**
   * Copied verbatim from the spec plus any accumulated.
   */
  constraints: string[];
  done_criteria: string[];
  key_decisions: string[];
  open_subgoals: string[];
}
export interface Snapshot {
  /**
   * path -> sha256. v3/D4: excludes __pycache__/, *.pyc, .pytest_cache/ — otherwise every run_tests call perturbs the map and the chain records phantom diffs.
   */
  file_hashes: {
    [k: string]: string;
  };
  /**
   * runs/{run_id}/snapshots/{ckpt_id}/
   */
  files_ref: string;
  scratchpad: string;
}
