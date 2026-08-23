# Run of show — 3 minutes

**50 seconds of setup slides, 90 seconds of demo, 25 seconds to close.**

The demo is the split-screen race. It is not an illustration of the claim, it *is* the claim: same
task, same sabotage, same moment, and the supervisor allowed to act in only one arm. Everything on
the deck before it exists to make the room understand what they are about to watch, and everything
after it exists to say what it cost.

Deck: `docs/slides.html` (`?s=N` jumps to a slide), `docs/dhruva.pptx` as a fallback.

---

## Before you're on

```bash
make dev
```

Open a second window on `http://localhost:5173`, click **▶ supervised vs unsupervised** in the left
rail, then hit the rail toggle (or `cmd B`) so the panes have the whole screen. The clock starts
paused at zero.

**Controls:** `space` plays and pauses. While a beat is held, `space` advances to the next beat
instead. `R` restarts.

Nothing here touches the network. Both panes replay real logs from disk, through the same render
path a live run uses.

---

## The one sentence

If the room remembers nothing else, make it this:

> **Both agents were lied to. Both noticed. Only one was allowed to undo it.**

---

## Slides 1–3 · ~50 seconds

**Slide 1 — Dhruva.**
> "Dhruva watches an agent work, catches it losing the plot, and puts the work back without wiping
> what it learned."

**Slide 2 — the problem.**
> "Long-running agents don't crash. They drift. A tool hands back something false, a constraint gets
> summarised away, and the agent keeps working confidently on the wrong thing. Nothing throws. The
> logs look busy.
>
> Rollback is the obvious fix, and rollback is lossy. Revert the files and you also destroy
> everything the agent legitimately figured out on the way."

**Slide 3 — the mechanism.**
> "So we split them. Work state gets checkpointed and restored. Knowledge is append-only, and every
> belief records where it came from. On a breach the files go back and the knowledge stays, minus
> whatever traces to the corruption."

Then switch to the browser. Do not narrate the switch.

---

## Demo · ~90 seconds

### 0:00 — press space, then say nothing for three seconds

Let them see two identical panes. The silence is doing work: the audience has to register that
these are the same run before the divergence means anything.

> "Same task. Twelve failing tests, make them pass. Same agent, same schedule, same sabotage at
> step twelve. One difference: on the left, the supervisor is allowed to act."

### 0:10 — point at the two rows inside each pane

This is the graphic the whole demo rests on. Say it slowly.

> "Top row, in amber, is what the agent **believes** is passing. Bottom row is what's **actually**
> passing. Right now they agree."

### 0:25 — the lie lands

A band appears across the top: `WHAT THE TOOL REPORTED: 12 passed, 0 failed` against
`WHAT WAS TRUE: 8/12 actually passing`.

> "The test tool just lied to it. Says twelve passed. Eight did. Watch the two rows come apart."

The amber row fills. The truth row does not. Both panes do this identically.

> "The agent now believes it's finished. It isn't. Nothing crashed, nothing warned it, and both runs
> are equally fooled. That's drift from the inside."

### 0:50 — both breach

Both panes read `C 0.15`. Both read `DRIFT DETECTED`. The right-hand one adds *no action permitted*.

**This is the beat the whole pitch turns on. Land it.**

> "Both runs scored that window. Same number, same sequence, 0.151 against a breach line of 0.608.
> Neither of them is blind. Detection was never the hard part."

### 1:00 — the four beats, `space` between each

`HALT`, `RESTORE`, `AUDIT`, `PRE-FLIGHT`. Hold on AUDIT.

> "Halt. Restore the tree from the last confirmed checkpoint. Then the audit: eight beliefs kept,
> three evicted."

Point at the three struck-through lines.

> "Read those three. They're **true**. We drop them anyway, because their trail runs through the
> lie. We evict on where a belief came from, not on whether it looks right, because checking whether
> it's right means asking a model, and no model call is allowed on this path."

Then the last beat:

> "And it doesn't just resume. It makes the agent propose its next step and checks that proposal
> before letting it run."

### 1:20 — the finish

Left pane: both rows full, 12/12, agreed. Right pane: 0/12, `✕ never recovered`.

> "Left finished the job. Right never did. It saw the same problem at the same moment and had to
> keep going.
>
> Every observability tool you already run is the right-hand pane."

If you are running long, that last line is the exit. Skip to slide 7.

---

## Slides 6–7 · ~25 seconds

Skip slide 5. It shows the result you just demonstrated live, and re-showing it deflates the demo.

**Slide 6 — what survived.**
> "Eviction has to be precise or it's amnesia with extra steps. Keep everything and you carry the
> lie forward. Throw away the whole affected range, which is what rollback means without
> provenance, and you destroy real knowledge. Only the third option gets both right, and it needs
> every belief to record its own source."

**Slide 7 — close.**
> "Three adapter seams: your agent, your models, your task. Nothing above them changes.
>
> Other tools tell you what went wrong. This one puts it back."

---

## If something breaks

| symptom | do this |
|---|---|
| Race won't load | `make demo` in a terminal. Same arc, prints the trace, no browser. |
| Clock is somewhere odd | `R` restarts from zero, paused. |
| Ran long | Stop at "every observability tool you already run is the right-hand pane." Then slide 7. |
| Asked "is this live?" | Say it plainly: these are two real runs replaying from their own event logs. Offer `run with scenario` in the rail to do it live; it takes a few minutes. Never claim it's live. |

---

## Questions to expect

**"Is this rigged?"** It was, once, in the opposite direction, and we caught it. The scripted drift
was originally inert, so the unsupervised arm wandered past harmless distraction and *won* while the
supervised arm paid to roll back damage that never happened. We made the drift actually destructive,
which is what the injected instruction demands anyway. Both arms breach at the identical score, so
the comparison isn't detection versus no detection.

**"How is this different from retrying?"** A retry restarts from the same corrupted context: same
bad instruction, same false belief, same outcome. This restores a verified state, rebuilds the
context from a compressed goal rather than the poisoned history, checks the proposed next step
before it runs, and keeps the knowledge.

**"Isn't this an LLM grading an LLM?"** Sixty percent of it. The other forty is arithmetic:
repetition distance over recent actions, and passing tests over total. The judge also runs on a
different vendor than the agent. If it fails outright it degrades to a neutral prior rather than a
false alarm.

**"How do you know it isn't false-alarming on good work?"** Calibration. Clean runs bottom out at
0.708 and the warn line had been sitting at 0.700, so a correct run was one unlucky sample from an
alarm. It's now set with a 0.05 margin and pinned by a test. Drift trips at 0.151, well clear.

**"What does it cost?"** One model call per five-step window, with knowledge extraction riding the
same call. The rollback audit is zero model calls.

**"What if the agent games the metric?"** That's scenario S3, and it's the one that attacks the
progress signal itself by editing the test suite. The task pack counts only twelve known test IDs
and hash-checks every test file against a shipped baseline. Tampering is an immediate alarm rather
than a low score, because a number computed from files that were just rewritten isn't a low
measurement, it's an invalid one.

**"Does it work with multiple agents?"** The contracts carry `agent_id` and `swarm_id` and reserve
the swarm event types. The ledger is what would make it cheap, since cross-agent disagreement shows
up as a contradiction against one shared store rather than every pair. Not built, and deliberately
out of scope for one day.

**"What's the honest limitation?"** 199 tests pass and they were blind to five real defects,
including one where a rollback could restore corrupted state. Every one surfaced within minutes of
watching a live model score live windows. Mocked tests verify mechanism; they can't verify judgement
under real input.
