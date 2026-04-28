# Coral-context review — pair-vs-single, URL-shortener experiment

> **Companion to `REVIEW.md`.** GPT-5.5 reviewed the artifacts impartially with no Coral / project context. This file is the opposite: a project-side analysis of *why* the pair coordinated badly, anchored in specific moments in the trace, with attention to what's fixable at the Coral binding layer, what's a prompt issue, and what's model-side and out of reach. No re-application of the rubric — this is failure-mode forensics.

## TL;DR

The pair pattern didn't get a fair test in this run because **the thread died after iter 0**. Agent-B posted its two replies without `mentions`, agent-A's `team.wait` (which uses `coral_wait_for_mention` under the hood) never surfaced them, agent-A concluded the thread was empty, and from there both agents coordinated through the **filesystem** — reading each other's `/workspace` writes — instead of the thread. The defects both agents privately identified in iter 7 (open redirect) never reached shared state because shared state, by then, had no reader. This is fixable at the binding layer, mostly without prompt changes, and is the highest-leverage thing to address before the next run.

## Headline finding: thread death at iter 0

The coordination breakdown maps to three concrete moments visible in `trace/transcript.jsonl` and the agent JSONLs:

1. **Agent-A posts kickoff plan WITH mentions.** `transcript.jsonl` line 1: `mentions=['agent-B']`. Reaches agent-B fine.
2. **Agent-B posts response WITHOUT mentions, twice.** `transcript.jsonl` lines 2 and 3: `mentions=[]` on both. Agent-B's `team.post(threadId, content)` calls in `agents/agent-B.jsonl` iter 0 steps 1 and 3 omit the third `mentions` argument. The binding signature is `team.post(threadId, content, mentions?)` — `mentions` is optional, and the model dropped it.
3. **Agent-A's `team.wait` returns null three times in iter 1.** `agents/agent-A.jsonl` iter 1 steps 0–2 each call `team.wait` with progressively longer timeouts (30s → 60s → 10s after a workspace check); each returns `null`. Agent-A's reasoning at step 1: *"No message received, maybe the kick-off message hasn't arrived yet or the wait timed out."* At step 2: *"This might mean the message was already deliver[ed]."* Agent-A then gives up on the thread and reads `/workspace` to figure out what agent-B has been doing.

The mechanism: `team.wait()` is implemented via `coral_wait_for_mention` (per `team-swarm/agent-bindings/team.ts`), which filters by mention. Agent-B's mention-less posts existed in the thread but were filtered out for agent-A. Agent-A correctly inferred *something* had happened (workspace had files agent-B wrote) but could not see *what was said* about it.

After iter 1, the thread is functionally dead. Both agents continue calling `team.wait` periodically across the next 18 iters and continue receiving null. They each post once or twice more (still mostly without mentions). The 20-minute run ends with **3 total messages exchanged**, all clustered in the first 90 seconds.

## Failure mode catalogue

### F1 — Mentions discipline lives in the model, not the API

**What happened:** Agent-B forgot the optional third arg to `team.post` on its very first opportunity, twice in a row. Kimi K2.6 is competent but the model treats optional parameters as droppable — especially when the prompt's example code (in `coral-agent.toml`) shows `team.post(threadId, content, mentions?)` with the `?` marking it optional.

**Where it bites:** Every message without mentions is invisible to peers using `team.wait`. There's no error, no retry, no log line — the message is silently scoped out of every other agent's perception.

**Citation:** `agents/agent-B.jsonl` iter 0 step 1 and step 3. `transcript.jsonl` lines 2-3 (`mentions=[]`).

**Layer:** Binding. Fixable without prompt changes.

### F2 — `team.wait` is a mention-filter, not a "what happened on the thread" primitive

**What happened:** Agent-A repeatedly called `team.wait` and got null when there *were* messages on the thread, just not mention-tagged for agent-A. The agent had no way to inspect thread state without waiting for someone to remember to mention it.

**Where it bites:** Once mention discipline breaks anywhere in the conversation, the thread becomes write-only for that direction. The agent has no "give me the recent thread state" affordance.

**Citation:** `agents/agent-A.jsonl` iter 1 steps 0-2; iter 7 step 4 (still calling `team.wait` 6 iters later, still getting null).

**Layer:** Binding. Coral exposes `coral_list_messages` (or equivalent) which would back this; the binding just doesn't surface it.

### F3 — ThreadId lives only in agent-side state, lost between iters

**What happened:** Agent-B iter 1 step 0 reasoning: *"My first action should be to check the kick-off message from the team-room thread."* Agent-B *already had the threadId* in iter 0 — it saved it as `const threadId = "98b6eea1-..."` and used it for posts. But each outer iter is a fresh `generateText` call; the model's reasoning starts fresh and doesn't reliably retrieve the threadId from earlier message history. So iter 1 wastes 3 wait-cycles trying to recover a kickoff that was already consumed.

**Where it bites:** Per-iter cold-start tax. The runner *knows* the threadId (it created the thread in `puppetCreateThread`). Passing it as an agent option (the same way `RUN_DIR`, `SOLO_MODE`, `DAYTONA_SANDBOX_ID` are) would eliminate the kickoff-discovery dance entirely.

**Citation:** `agents/agent-B.jsonl` iter 1 steps 0-2 vs. iter 0 steps 1-3 (where threadId was already known).

**Layer:** Operator + binding. Runner injects `TEAM_ROOM_THREAD_ID`, binding exposes `team.threadId()` getter.

### F4 — No state recovery on null wait

**What happened:** When `team.wait` returns null, the binding gives the agent no signal about whether (a) nothing was posted, (b) something was posted but not mentioned to me, (c) something was posted and the watermark filtered it out. All three look identical from the model's POV, and they require very different recovery actions.

**Where it bites:** Agents over-rely on `team.wait` and have no fallback. When wait fails, there's no "let me see what *did* happen on the thread."

**Citation:** General pattern across both traces. Agent-A iter 1, iter 4, iter 7 all show the same wait-then-give-up pattern.

**Layer:** Binding. Add `team.history({limit, since?})` or `team.peek()` as a non-mention-filtered read.

### F5 — Prompt frames the thread as chat, not state

**What happened:** `coral-agent.toml` calls team-room "your shared coordination channel." The kickoff message says: *"Use team.wait() to receive teammate replies, team.post(threadId, ...) to send."* This is conversational framing. The model treats the thread accordingly: small-talk style messages, no structure, no follow-up posts after the initial introductions.

**Where it bites:** Agents post once at the start to introduce themselves, then never again unless prompted by an external event. There's no convention for "every meaningful change deserves a thread post" because the framing doesn't suggest it.

**Citation:** Both agents post 1-2 messages in iter 0, then go silent. Iter 7 of both agents catches open redirect privately and reasons about it for 100s of tokens — neither posts anything to thread about it. `agents/agent-A.jsonl` iter 7 step 4: *"Open redirect vulnerability — the redirect endpoint accepts any URL including javascript: and fil[e]."* Tool call that follows: a 5-second `team.wait`, not a `team.post` about the issue.

**Layer:** Prompt. Codex's "shared ledger" framing is the right reframe.

### F6 — No iter-loop nudge to externalize state

**What happened:** The agent's outer loop in `run-agent.ts` runs `generateText` continuously with no per-iter hook. Whatever the model decides to do, it does. There's no "before closing this iter, post a status update if anything material changed" step.

**Where it bites:** Compounds F5. Even if the prompt told agents to externalize, there's no enforcement mechanism beyond the agent's own discipline. After iter 5+ the model has lots of reasoning context to draw from but no structural reminder to share it.

**Citation:** Compare any iter's tool call sequence — they're whatever the model picked, not a fixed pattern.

**Layer:** Runtime. Could be done as a prompt-only "every iter must end with a thread post" rule, but stronger as a synthetic message injected by the agent runtime at iter boundaries.

### F7 — Cleanup race shows up in the trace tail

**What happened:** `agents/agent-A.jsonl` iter 10: *"The Daytona read is failing with 401."* This is the sandbox dying mid-iter as the runner reaches wallclock and starts cleanup. Pre-existing issue — already documented in `foundation_coral-koog-swarm-patterns.md` as the homogeneous-write-race surface.

**Where it bites:** Last 1-2 iters of every long run produce noise that looks like work but isn't. For experiments that judge final artifacts, doesn't really matter (artifact is exported before cleanup). For experiments that judge trace quality, polluting noise.

**Layer:** Runner. Out of scope for this review; flagging only.

## Coral binding layer recommendations

These are the changes I'd ship before the next experiment, in priority order. All are local to `team-swarm/agent-bindings/team.ts` and the runner; no Coral upstream changes needed.

### 1. Pass `TEAM_ROOM_THREAD_ID` as an agent option (eliminates F3)

The runner knows the threadId after `puppetCreateThread`. Pass it via `buildSessionSpec` like every other agent option. Binding reads it from env at boot. Agents never have to discover the threadId by waiting for kickoff.

```ts
// In team.ts (binding)
const TEAM_ROOM_THREAD_ID = process.env.TEAM_ROOM_THREAD_ID;
export const team = {
  threadId: () => TEAM_ROOM_THREAD_ID,
  post: (content: string, mentions?: string[]) => /* uses TEAM_ROOM_THREAD_ID internally */,
  // ...
};
```

Note this also lets `team.post(content, mentions)` drop the `threadId` parameter entirely — one fewer thing for the model to track.

### 2. Make `mentions` non-droppable (addresses F1)

Two options, in order of strength:

- **Strong:** Remove the `mentions` parameter from `team.post`. Auto-mention all peers (the binding knows peer names; the runner can pass `TEAM_PEER_NAMES` as an agent option). Renames the call to `team.broadcast(content)` to make this semantic explicit.
- **Soft:** Keep `team.post(content, mentions)` but make `mentions` required. Throw at the binding layer if the array is empty AND no peers are auto-detected.

I'd ship the strong version. The "I want to send a private aside to one specific peer" use case doesn't apply in a homogeneous-coordination experiment with 2 agents.

### 3. Add `team.history({limit, since?})` (addresses F2 + F4)

A non-mention-filtered read of recent thread messages. Backed by `coral_list_messages` (or whatever Coral's equivalent is — worth verifying via deepwiki, but the substrate has it). When `team.wait` returns null, the agent has a recovery path: *"let me see what's on the thread that I missed."*

```ts
team.history: (opts?: {limit?: number; since?: string}) => Promise<TeamMessage[]>
```

### 4. (Optional) `team.openIssue` / `team.closeIssue` helpers (addresses F5 + F6 partially)

Per Codex's structured-protocol idea, but as binding helpers rather than YAML-on-the-wire. These post structured messages that the binding parses on the receive side, so when an agent calls `team.history`, it sees `{kind: "issue", id, severity, status, evidence}` records, not free-text it has to re-parse.

Lower priority than 1-3. Worth shipping only if the prompt-only ledger framing (next section) doesn't generate enough structured behavior on its own.

## Coral prompt recommendations

Independent of the binding work, two prompt changes that are zero-cost and worth doing in the same revision:

### 1. Reframe team-room as the team's append-only state log

Replace the current "shared coordination channel" language in `coral-agent.toml` with something like:

> The team-room thread is your team's append-only state log. Treat it as the only authoritative record of what's been decided, who owns what, what's open, and what's done. **If a fact is not in the thread, it does not exist as shared state.** When you make a meaningful decision, finish a unit of work, find a bug, or change ownership, post to the thread. Posting too much is much cheaper than posting too little.

This is Codex's reframe and it's correct. Lifts F5 directly.

### 2. Drop the team-room threadId discovery section

Once F3 is fixed at the binding layer, the prompt's entire "Your first action / The message you receive will include `threadId` — that is the team-room thread id. Save it" section becomes obsolete and confusing. Replace with a one-liner: *"Your first action should be `team.history()` to see whatever the team has discussed so far."* This naturally introduces the new history primitive and gives the agent something productive to do at iter 0 instead of waiting on a kickoff that may have already been consumed.

## What the Coral layer can't fix (model-side)

A few things from this run that are *not* binding or prompt issues — the model just behaved suboptimally and no API change rescues it:

- **Single arm iter 7:** *"I should just build the app as a normal user would, without overthinking security."* The single agent saw something in its context (probably evaluation framing leaking from the seed prompt or an internal heuristic about "what a real user wants") and downgraded its security work. No Coral fix touches this. Mitigation is upstream: scrub anything that hints at evaluation/research/experiment from what reaches the model. Worth checking what `buildSeed` actually produces under `--solo` to see if anything leaks.
- **Both arms wrote dead code.** Pair has unused `deleteLink`. Single has an entire stale `index.ts + tests` path. These are catches a real pair would surface in a code review, but neither agent noticed in the trace. This is a model-attention issue (deeper context, more tokens — diminishing returns under iter 5).
- **Both agents privately reasoned correctly about open redirect, neither shipped a fix.** The structural fix (force externalization) addresses the *coordination* failure but doesn't make either agent actually patch the code. If both agents externalize "open redirect is open" to thread, you'd get two agents agreeing it's open — neither has been given the go-ahead-and-fix-it impulse the structural change alone provides. Closing the loop requires the prompt to explicitly say *"open issues in the thread are blocking until they have a corresponding closed-issue post."*

## Suggested follow-up experiments

Concrete, in priority order:

1. **Re-run pair under the binding fixes (1-3 above) + prompt reframe with the same URL-shortener prompt.** Does the thread stay alive past iter 0? Does the catch-credit tally improve? This is the cheapest, highest-signal experiment and it's a same-arm A/B against this run as the baseline.
2. **Add a 4th replicate to each of {solo, pair-baseline, pair-fixed} for variance.** This run is N=1 per arm. Without replicates we can't separate signal from K2.6's iter-to-iter variance.
3. **Codex's 3-arm ladder (chat-only / prompt-only ledger / prompt + binding helpers).** Specifically *after* the binding fixes above, this isolates "did the prompt reframe alone lift performance, or did we also need the binding ergonomics?" Doing this before binding fixes confounds the two effects.
4. **Sweep model.** The pair pattern's success may be model-dependent. Once the binding is right, run the same prompt against Sonnet 4.6, Haiku 4.5, and DeepSeek V4 to see whether the pair value-add is uniform across models or unique to certain ones.

## Files referenced

- `research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/trace/transcript.jsonl`
- `research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/trace/agents/agent-A.jsonl`
- `research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/trace/agents/agent-B.jsonl`
- `team-swarm/agent-bindings/team.ts`
- `team-swarm/agent/coral-agent.toml`
- `orchestration/run-swarm-task.ts`
- `foundation_coral-koog-swarm-patterns.md` (memory)
