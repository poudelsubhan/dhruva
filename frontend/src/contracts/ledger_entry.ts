/* GENERATED from shared/schema/ledger_entry.schema.json — do not edit. Regenerate: npm run contracts */

/**
 * One accumulated learning. Knowledge is append-only and taint-tracked, separate from work state: on rollback the workdir reverts but clean knowledge is retained.
 */
export interface LedgerEntry {
  /**
   * sha256(canonical_json({run_id, minted_at_seq, kind, text_normalized}))[:16]. Computed over IMMUTABLE fields only, so an entry's id survives every status change.
   */
  id: string;
  run_id: string;
  agent_id?: string | null;
  kind: "fact" | "constraint" | "failed_approach" | "resource" | "api_shape";
  /**
   * One assertion, <=30 words.
   */
  text: string;
  confidence: number;
  /**
   * Events this was derived from. Intersecting poison_seqs is what makes taint exact rather than guessed.
   *
   * @minItems 1
   */
  source_seqs: [number, ...number[]];
  minted_at_seq: number;
  checkpoint_ref?: string | null;
  /**
   * MUTABLE — outside the id and outside every hash.
   */
  status: "clean" | "suspect" | "evicted";
  status_reason?: string | null;
  supersedes?: string | null;
  superseded_by?: string | null;
  /**
   * Every injection of this entry into a context. Enables exact taint closure.
   */
  uses?: {
    agent_id?: string | null;
    at_seq: number;
  }[];
  /**
   * task_pack entries persist to fixtures/<pack>/ledger.jsonl on a successful run and seed the next run at confidence * 0.8.
   */
  scope: "run" | "task_pack";
  /**
   * v3: failed_approach entries are admitted from ANY verdict at halved confidence. Pass-only admission is anti-correlated with value — a window verdicts incoherent precisely when 'this approach fails' is true and most worth keeping.
   */
  admitted_from_verdict?: "pass" | "warn" | "breach";
}
