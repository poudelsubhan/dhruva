# Demo script — 3 minutes

**Before you start:** `make dev`, browser on http://localhost:5173, scenario **S2** selected,
**at step 12**. Have `make demo-all` already run once in a terminal behind you — if the live path
misbehaves, that terminal is your fallback and it takes ten seconds to switch to.

---

### 0:00 — The problem (20s)

> "Long-horizon agents don't crash. They drift. A tool lies, a constraint gets compacted away — and
> the agent keeps working, confidently, on the wrong thing. You find out an hour later.
>
> The obvious fix is rollback. But rollback has a cost nobody prices in: it's *lossy*. You revert
> the tree and you also destroy everything the agent legitimately learned. It re-derives it, and
> often re-walks the same dead ends."

### 0:20 — Start the run (15s)

Click **run with scenario**. Point at the header while it spins up.

> "The agent's on Sonnet. The judge is on GPT-5-mini — deliberately a different family, so the
> verifier is never grading the model that produced the work."

### 0:35 — Clean progress (30s)

Point at the twelve-lamp board as group A fills, then B.

> "Twelve tests, three independent groups. That board is the objective signal — not the agent's
> opinion of itself. The dial is composite coherence: alignment from the judge, plus repetition and
> progress, which are pure arithmetic. Two of the three terms can't be argued with."

Point at the checkpoint chain.

> "Checkpoints are hash-chained and only minted after a passing window. And notice — *confirmed*.
> A checkpoint only becomes a valid rollback target once the window *after* it also passes.
> Otherwise you can roll back into the corruption."

### 1:05 — The injection (25s)

The `injection` glyph appears, then the poisoned observation.

> "There's the corruption. The test runner just lied — it reported all twelve green."

**Pause. Let the next window pass.**

> "And watch: the supervisor *doesn't* catch it yet. That window still scores as coherent, because
> the agent is doing plausible work and the falsified result agrees with it. It even banks a new
> belief: *the suite passes, the module is complete*. That's the honest part — drift takes a window
> to become visible, and by then the false belief is already in the ledger."

### 1:30 — The breach (20s)

Coherence collapses. Red.

> "Now it's caught. Coherence drops through the floor, and the supervisor halts stepping."

### 1:50 — **The frame** (40s)

The rollback arc fires. Point at the ledger panel.

> "Rollback to the last confirmed checkpoint. The tree reverts — you can watch four lamps go dark.
>
> But look at the ledger. **Seven learnings kept. Three evicted.** It didn't wipe the agent's
> memory. It traced provenance: anything sourced from that poisoned observation is gone, and
> everything the agent genuinely figured out before the corruption survives — and gets re-injected
> into the rebuilt context, along with an explicit note that it was wrong about the suite passing.
>
> That's the whole idea. **Rollback without amnesia.**"

Point at the pre-flight verification.

> "And before it's allowed to resume, it has to *propose* its next step and have that checked
> against the original intent. It doesn't get to act first."

### 2:30 — Recovery and the number (25s)

Lamps relight, run completes 12/12.

> "Back to twelve out of twelve."

Switch to the terminal (`make measure`).

> "And this is the claim, measured rather than asserted. Three eviction policies over the same log.
> Keep everything: you carry the false belief forward. Evict the whole discarded range — which is
> what rollback means without provenance — you destroy clean knowledge. Provenance-based eviction
> is the only one that's correct on both axes."

### 2:55 — Close (10s)

> "Framework-agnostic — three adapter seams, so it wraps whatever loop you've got. Everything you
> saw came off one append-only event log, which is also what the replay renders from."

---

## If something breaks

| symptom | do this |
|---|---|
| Run stalls or the provider errors | Switch to the terminal, `make demo-all` — same arc, offline, deterministic |
| UI looks wrong | **mock breach** button — pre-recorded log, same render path |
| Judge is slow | Keep talking through the mechanism; the lamps and chain are still updating |
| Asked "is this real?" | `GET /api/runs/{id}/events` is the raw log. Everything on screen derives from it. |

## Questions you should expect

**"How is this different from just retrying?"** A retry restarts from the same corrupted context.
This restores a verified *state*, rebuilds the context from a compressed intent, and gates the
resume on a pre-flight check. And it keeps the knowledge.

**"Doesn't the judge cost a call per window?"** One, and learning extraction rides the same call —
no extra latency. The taint audit on the rollback path is pure arithmetic: no model call at all,
because that path must not stall.

**"What if the judge is wrong?"** It's 0.6 of the score; the other 0.4 is arithmetic. A judge
failure degrades to a neutral prior rather than a breach. And ground truth — the test suite — is
hash-verified against a baseline, so the one scenario that attacks the metric gets caught
independently of any model.

**"Does it work with N agents?"** Contracts carry `agent_id`/`swarm_id` and reserve the swarm event
types. The ledger is what makes it cheap: cross-agent divergence shows up as a contradiction against
the shared ledger head, which is O(N) per barrier rather than O(N²). Not built today — deliberately.
