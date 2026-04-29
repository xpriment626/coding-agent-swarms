# Coral-context review — pair-vs-single, URL-shortener experiment

> **Companion to `REVIEW.md`.** GPT-5.5 reviewed the artifacts impartially with no Coral / project context. This file is the opposite: a substrate-side analysis of *why* the pair coordinated badly, anchored in specific moments in the trace. **Scope is intentionally narrow:** observations of what failed in this run + which native Coral primitives, had they been used, would have addressed each failure. Recommendations for binding rewrites, prompt reframes, custom server tools, or product-level architecture changes are out of scope — they're conversation topics, not findings about the substrate.

## TL;DR

The pair pattern didn't get a fair test in this run because **the thread died after iter 0**. Agent-B posted its two replies without `mentions`, agent-A's `team.wait` (mention-filtered) silenced them, and from there both agents fell back to coordinating through filesystem state instead of the thread. The defects both agents privately identified at iter 7 (open redirect) never reached shared state because shared state had no reader.

The substrate had remedies we never used. Coral exposes a built-in **`coral://state` MCP resource** that returns the agent's full participation-scoped thread view — including non-mention messages — and a **`coral_wait_for_agent`** tool that blocks for messages from a specific named peer regardless of mention discipline. Either one, surfaced through the binding, would have given agent-A a single-call recovery path the moment its first wait returned null. Neither was on the per-agent MCP surface our `team.ts` binding exposes.

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

### F2 — `team.wait` is a mention-filter, not a "what happened on the thread" primitive

**What happened:** Agent-A repeatedly called `team.wait` and got null when there *were* messages on the thread, just not mention-tagged for agent-A. The agent had no way to inspect thread state without waiting for someone to remember to mention it.

**Where it bites:** Once mention discipline breaks anywhere in the conversation, the thread becomes write-only for that direction. The agent has no "give me the recent thread state" affordance.

**Citation:** `agents/agent-A.jsonl` iter 1 steps 0-2; iter 7 step 4 (still calling `team.wait` 6 iters later, still getting null).

### F3 — ThreadId lives only in agent-side state, lost between iters

**What happened:** Agent-B iter 1 step 0 reasoning: *"My first action should be to check the kick-off message from the team-room thread."* Agent-B *already had the threadId* in iter 0 — it saved it as `const threadId = "98b6eea1-..."` and used it for posts. But each outer iter is a fresh `generateText` call; the model's reasoning starts fresh and doesn't reliably retrieve the threadId from earlier message history. So iter 1 wastes 3 wait-cycles trying to recover a kickoff that was already consumed.

**Where it bites:** Per-iter cold-start tax. The agent burns wallclock and tokens rediscovering state it already had.

**Citation:** `agents/agent-B.jsonl` iter 1 steps 0-2 vs. iter 0 steps 1-3 (where threadId was already known).

### F4 — No state recovery on null wait

**What happened:** When `team.wait` returns null, the binding gives the agent no signal about whether (a) nothing was posted, (b) something was posted but not mentioned to me, (c) something was posted and the watermark filtered it out. All three look identical from the model's POV, and they require very different recovery actions.

**Where it bites:** Agents over-rely on `team.wait` and have no fallback. When wait fails, there's no "let me see what *did* happen on the thread."

**Citation:** General pattern across both traces. Agent-A iter 1, iter 4, iter 7 all show the same wait-then-give-up pattern.

### F5 — Prompt frames the thread as chat, not state

**What happened:** `coral-agent.toml` calls team-room "your shared coordination channel." The kickoff message says: *"Use team.wait() to receive teammate replies, team.post(threadId, ...) to send."* This is conversational framing. The model treats the thread accordingly: small-talk style messages, no structure, no follow-up posts after the initial introductions.

**Where it bites:** Agents post once at the start to introduce themselves, then never again unless prompted by an external event. There's no convention for "every meaningful change deserves a thread post" because the framing doesn't suggest it.

**Citation:** Both agents post 1-2 messages in iter 0, then go silent. Iter 7 of both agents catches open redirect privately and reasons about it for 100s of tokens — neither posts anything to thread about it. `agents/agent-A.jsonl` iter 7 step 4: *"Open redirect vulnerability — the redirect endpoint accepts any URL including javascript: and fil[e]."* Tool call that follows: a 5-second `team.wait`, not a `team.post` about the issue.

### F6 — No iter-loop nudge to externalize state

**What happened:** The agent's outer loop in `run-agent.ts` runs `generateText` continuously with no per-iter hook. Whatever the model decides to do, it does. There's no "before closing this iter, post a status update if anything material changed" step.

**Where it bites:** Compounds F5. Even if the prompt told agents to externalize, there's no enforcement mechanism beyond the agent's own discipline. After iter 5+ the model has lots of reasoning context to draw from but no structural reminder to share it.

**Citation:** Compare any iter's tool call sequence — they're whatever the model picked, not a fixed pattern.

### F7 — Cleanup race shows up in the trace tail

**What happened:** `agents/agent-A.jsonl` iter 10: *"The Daytona read is failing with 401."* This is the sandbox dying mid-iter as the runner reaches wallclock and starts cleanup. Pre-existing issue — already documented in `foundation_coral-koog-swarm-patterns.md` as the homogeneous-write-race surface.

**Where it bites:** Last 1-2 iters of every long run produce noise that looks like work but isn't. For experiments that judge final artifacts, doesn't really matter (artifact is exported before cleanup). For experiments that judge trace quality, polluting noise.

## Native Coral capabilities not used

Per upstream Coral source (verified via deepwiki against `Coral-Protocol/coral-server`), every SessionAgent's per-agent MCP server exposes 9 native MCP tools and 2 native MCP resources. Our `team-swarm/agent-bindings/team.ts` binding exposes only two of them: `coral_send_message` (as `team.post`) and `coral_wait_for_mention` (as `team.wait`). The seven primitives we *didn't* surface are below, ordered by how directly they would have addressed observed failures.

### `coral://state` — built-in MCP resource

Returns Markdown describing the requesting agent's observable session state: list of threads it participates in with all messages (regardless of mention status), connection/wait status of every linked agent, and current session timestamps. Per-agent participation-scoped — agent-A's read returns agent-A's view, agent-B's returns B's view. Backed by `handleStateResource` in `SessionAgent.kt`; no caching, fresh on every read.

**Would have addressed:** F2 (mention-filter blindness), F3 (threadId loss — list of participating threads is in the response), F4 (no recovery on null wait). The single largest cluster of observed failures collapses if this resource is read after every wait timeout.

**Why we missed it:** Our binding only surfaces MCP tool calls, not MCP resource reads. The resource was sitting on the per-agent MCP server the entire run, never queried.

### `coral_wait_for_agent(agentName)` — MCP tool

Blocks until a message arrives from a specific named agent, independent of mention status or thread.

**Would have addressed:** F1. Agent-A could have called `coral_wait_for_agent("agent-B")` after its kickoff post and received agent-B's mention-less reply directly, no mention-filter in the path.

**Why we missed it:** We didn't know this primitive existed. Not documented in `foundation_coral-koog-swarm-patterns.md`; not surfaced in our binding.

### `coral_wait_for_message` — MCP tool

Same shape as `coral_wait_for_mention` but with no mention filter. Blocks until *any* message arrives in any thread the agent participates in.

**Would have addressed:** F1, F2 (partial). Had agent-A waited via this primitive instead of `wait_for_mention`, agent-B's mention-less posts would have unblocked it normally.

**Why we missed it:** Foundation memory documents a deliberate prior-session decision to use `wait_for_mention` for routing reasons. Decision was made consciously; this run is a clear illustration of the cost of that trade-off when the mention contract isn't reliably honored upstream.

### `coral_add_participant` / `coral_remove_participant` — MCP tools

Dynamic thread membership: add or remove an agent from an existing thread without ending the session.

**Would have addressed:** None of F1–F7 directly. Worth flagging as enabling-pattern — supports topologies like "spawn a reviewer agent only after implementer says done" or "remove the puppet from team-room once kickoff is delivered, eliminating it from every agent's `coral://state` views." Out of scope for a static 2-agent pair; relevant if topology becomes dynamic.

**Why we missed it:** No use case in the current static-pair shape.

### `coral_close_thread(summary)` — MCP tool

Closes a thread with a summary message attached at the substrate level.

**Would have addressed:** None of F1–F7 directly. Worth flagging as observability — when the team thinks they're done, they post a summary of what happened. Captured at the substrate as a thread state transition, not derivable from message-tail heuristics or operator-side polling.

**Why we missed it:** Acceptance gating happens at the runner layer (file existence check, wallclock); thread state is never consulted for "is the team done."

### `coral://instructions` — built-in MCP resource

Markdown aggregation of `McpInstructionSnippet` entries registered against the agent's available tools. Coral plugins can attach custom instruction snippets to their tool registrations; these flow into every agent's resource read alongside the built-in tool docs.

**Would have addressed:** F5 (prompt frames thread as chat) — *if* a custom Coral plugin registered behavioral instruction snippets like "treat team-room as append-only ledger" alongside its message-passing tools, the framing would land at the substrate level and be visible in every agent's `coral://instructions` read, regardless of what `coral-agent.toml` says.

**Why we missed it:** We don't ship custom Coral plugins. The instructions resource is currently populated only by built-in tool snippets.

### `coral_close_session` — MCP tool (plugin-controlled)

Terminates all agents in the session at the substrate level.

**Would have addressed:** None of F1–F7 directly. F7 (cleanup race) is operator-side — the runner currently destroys the sandbox via Daytona REST, so this primitive isn't on our cleanup path. Worth flagging that prior session findings (`foundation_coral-koog-swarm-patterns.md`) record this primitive as unreliable when called from agents; consider re-verifying against the latest Coral if substrate-side closure becomes desirable.

**Why we missed it:** Closure is operator-owned per existing project rule.

## What native Coral can't address (model-side)

Three things from this run that no native primitive — used or unused — addresses:

- **Single arm iter 7:** *"I should just build the app as a normal user would, without overthinking security."* The single agent saw something in its context that downgraded its security posture. No native primitive controls what reaches the agent's context window. Mitigation is upstream of Coral entirely: scrub anything that hints at evaluation/research/experiment from what gets passed to `EXTRA_INITIAL_USER_PROMPT`.
- **Both arms wrote dead code.** Pair has unused `deleteLink`. Single has an entire stale `index.ts + tests` path. Coral has no pre-emptive code-review primitive; this is model-attention territory and not a substrate question.
- **Both agents privately reasoned correctly about open redirect, neither shipped a fix.** Surfacing thread state via `coral://state` addresses the *coordination* failure (agent-A would have seen agent-B's reply, both could have raised the issue in thread). It does not address the *follow-through* failure — both agents could agree open redirect is open in thread, and still neither writes the patch. That's a model-behavior pattern, not a substrate gap.

## Suggested follow-up experiments

Each tests whether using a specific native Coral primitive changes the failure rate observed in this run.

1. **Surface `coral://state` reads and re-run pair under the same prompt.** Lowest-cost, highest-leverage test — does adding one resource read to the binding change F2/F3/F4? Same prompt, same model, same wallclock; only difference is the agent can fetch canonical thread state when its wait returns null. If thread stays alive past iter 0 in 2/3 replicates, the primitive landed.
2. **Switch the wait primitive from `coral_wait_for_mention` to `coral_wait_for_message`.** Tests whether F1 (mention-discipline) bites when the wait isn't filtered. Could be combined with #1 or run separately to isolate the effect.
3. **Sweep replicates per arm.** This run is N=1 per arm. Even before changing anything else, three replicates per condition tells us how much of what we observed was K2.6 variance vs. structural failure.
4. **Sweep model.** Once we know native primitive use changes outcomes, run the same setup against Sonnet 4.6, Haiku 4.5, and DeepSeek V4. The mention-discipline failure may be model-specific or universal; can't tell from one model.

## Files referenced

- `research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/trace/transcript.jsonl`
- `research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/trace/agents/agent-A.jsonl`
- `research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/trace/agents/agent-B.jsonl`
- `team-swarm/agent-bindings/team.ts`
- `team-swarm/agent/coral-agent.toml`
- `foundation_coral-koog-swarm-patterns.md` (memory)
- Upstream Coral source: `https://github.com/Coral-Protocol/coral-server` (`McpToolManager.kt`, `McpToolName.kt`, `McpResourceName.kt`, `SessionAgent.kt`)
