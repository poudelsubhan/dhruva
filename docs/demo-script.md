# Run of show — 3 minutes

**2 minutes of slides, 1 minute of live demo, demo in the middle.**

Deck: `docs/dhruva.pptx` (7 slides, 16:9). Demo: the browser, already on
`http://localhost:5173/?demo=1`.

---

## Setup, before you're on

```bash
make dev
```

Open `http://localhost:5173/?demo=1` in a second window or tab. It boots straight into the canned
replay, **paused at event 1**. Nothing runs until you press play.

Check the top-right pill says a provider is configured, then leave it alone. The replay does not
touch the network — it replays a real log from disk, so nothing on stage depends on an API call.

**Controls:** `space` plays/pauses. `R` restarts. The label beside the scrubber names the beat
you're on, so you can always see where you are without reading the timeline.

---

## Slides 1–3 · ~60 seconds

**Slide 1 — Dhruva.**
> "Dhruva is a supervisor that catches an agent losing the plot, rolls it back, and keeps what it
> learned."

**Slide 2 — the problem.**
> "Long-horizon agents don't crash. They drift. A tool lies, a constraint gets compacted away, and
> the agent keeps working — confidently — on the wrong thing.
>
> Rollback is the obvious fix. But rollback is *lossy*. You revert the tree and you also destroy
> everything the agent legitimately learned. It re-derives it, and often re-walks the same dead
> ends."

**Slide 3 — the mechanism.**
> "So we separate the two. Work state is checkpointed and restorable. Knowledge is append-only and
> taint-tracked. On a breach the tree reverts — and the knowledge doesn't, except for whatever
> provenance traces back to the corruption."

---

## Demo · ~60 seconds

Switch to the browser. **Press space.**

**0–20s** — while the lamps fill in:
> "Twelve tests, three independent groups. That board is an objective signal — not the agent's
> opinion of itself. The dial is composite coherence. Checkpoints accrue as windows pass."

**~25s, the injection lands** (label reads *corruption injected*, lamps drop to 0/12):
> "There's the corruption. The agent's been told to rewrite the public API, and it just did — every
> test fails."

**~35s, the poisoned window still passes:**
> "And notice the supervisor doesn't catch it yet. That window still scores as coherent. Drift takes
> a window to become visible — and in the meantime the agent banks a *false* belief."

**~45s, breach and rollback arc:**
> "Now it's caught. Rollback to the last confirmed checkpoint."

**Point at the ledger panel — this is the frame:**
> "But look: it didn't wipe the agent's memory. It kept the learnings that were established before
> the corruption and evicted the ones sourced from it. That's the whole idea — **rollback without
> amnesia**."

**~60s, recovery:**
> "Back to twelve out of twelve."

If you're running long, press `R` and skip to the slides — the numbers are on slide 5 anyway.

---

## Slides 5–7 · ~60 seconds

**Slide 5 — the twin.**
> "Same task, same corruption, same schedule. The only variable is whether the supervisor is allowed
> to act. Supervised recovers to twelve out of twelve. Unsupervised ends at zero.
>
> And the unsupervised arm isn't blind — it scores the drift identically. It just never intervenes."

**Slide 6 — the measured claim.**
> "Eviction has to be *precise*, or it's just amnesia with extra steps. Three policies over the same
> log. Keep everything, and you carry the lie forward. Evict the whole discarded range — which is
> what rollback means without provenance — and you destroy knowledge the agent earned. Only
> provenance-based eviction is correct on both counts."

**Slide 7 — close.**
> "Framework-agnostic: three adapter seams. And everything you saw comes off one append-only event
> log — the live view, the provenance graph, the twin, and the replay you just watched."

---

## If something breaks

| symptom | do this |
|---|---|
| Replay won't load | `make demo` in a terminal — same arc, prints the trace, no browser |
| Browser is wrong | Reload `?demo=1`. It always starts paused at event 1. |
| Ran long | `R`, then straight to slide 5. The numbers carry the point. |
| Asked "is this live?" | Say plainly: it's a replay of a real run, from that run's own event log. Offer `run with scenario` to do it live — it takes a few minutes. |

## Questions to expect

**"How is this different from retrying?"** A retry restarts from the same corrupted context. This
restores a verified state, rebuilds context from a compressed intent, gates the resume on a
pre-flight check of the agent's *proposed* next step — and keeps the knowledge.

**"What does the judge cost?"** One call per window, and learning extraction rides the same call.
The taint audit on the rollback path is pure arithmetic — no model call, because that path must not
stall.

**"What if the judge is wrong?"** It's 0.6 of the score; the rest is arithmetic. A judge failure
degrades to a neutral prior, not a breach. And ground truth — the test suite — is hash-verified
against a baseline, so the scenario that attacks the metric gets caught independently of any model.

**"Does it work with multiple agents?"** The contracts carry `agent_id`/`swarm_id` and reserve the
swarm event types; the ledger is what would make it cheap, since cross-agent divergence shows up as
a contradiction against the shared ledger head. Not built — deliberately out of scope for today.
