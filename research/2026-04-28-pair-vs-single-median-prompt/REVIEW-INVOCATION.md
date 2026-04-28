# GPT-5.5 review invocation

> Paste the block below into Codex (GPT-5.5) once both arms have finished running and their `code/` and `trace/` subfolders have been populated. Replace `<PAIR_RUN_ID>` and `<SINGLE_RUN_ID>` with the actual run directory names.

---

You are reviewing the output of an experiment that compares two coding-agent execution patterns on the same under-specified project prompt. Both arms used the same model (Kimi K2.6) and the same toolchain. One arm was a **pair** of two agents communicating peer-to-peer with no role assignment and no orchestrator; the other was a **single** agent running solo. Both wrote code into their own Daytona sandboxes, which were then exported into this repository.

Your job is to determine which arm's output is **less bad**, score both against a fixed rubric, and produce a final routing recommendation.

## What to read, in order

1. `research/2026-04-28-pair-vs-single-median-prompt/PROMPT.md` — the project prompt both arms received. This is the only ground truth for "what was asked."
2. `research/2026-04-28-pair-vs-single-median-prompt/RUBRIC.md` — your scoring rubric, the dimensions, the task-specific danger zones, and the required output format. Follow it precisely.
3. `research/2026-04-28-pair-vs-single-median-prompt/pair/<PAIR_RUN_ID>/code/` — the pair arm's exported `/workspace`. This is the artifact a hypothetical user would walk away with.
4. `research/2026-04-28-pair-vs-single-median-prompt/single/<SINGLE_RUN_ID>/code/` — the single arm's exported `/workspace`.
5. `research/2026-04-28-pair-vs-single-median-prompt/pair/<PAIR_RUN_ID>/trace/agent-A.jsonl` and `agent-B.jsonl` — per-iteration reasoning traces for the pair arm. JSONL where each line is one outer agent iteration. Each line has `agent`, `iter`, `model`, `durationMs`, `finishReason`, `usage`, and `steps[]`. Each step has `stepType`, `text`, `reasoning`, `reasoningDetails[]`, `toolCalls[]`. Read `reasoning` and `reasoningDetails[].text` to see what the agent was actually thinking before each tool call.
6. `research/2026-04-28-pair-vs-single-median-prompt/single/<SINGLE_RUN_ID>/trace/agent.jsonl` — same shape for the single arm.

The traces are essential. Artifact-only review tells you which arm shipped better code; trace-grounded review tells you *why*, and is the only way to credit the pair pattern for catches that happened during the work.

## What you produce

Write a single file: `research/2026-04-28-pair-vs-single-median-prompt/REVIEW.md`.

Follow the structure mandated by `RUBRIC.md`:

1. **Per-dimension scores, both arms** — each of the 8 dimensions, score 1-5, citation to `path/to/file:LN-LN` for every score that isn't a 3.
2. **Task-specific danger zones, both arms** — for each danger zone listed in the rubric, mark "addressed / partially addressed / missed" and cite code.
3. **Mid-flight observations, per arm** — 3-to-5 specific moments from the JSONL traces. Quote `reasoning` text and cite `iter` index. For the pair arm, surface any disagreement or pushback between the two agents.
4. **Catch-credit tally** — the two-column table.
5. **Verdict — least bad** — ≤300 words.
6. **Routing recommendation** — one line.

## Hard rules

- **No score without a citation.** A score that isn't 3 must point at code or at a trace line.
- **Don't grade against a senior-engineer ideal.** Grade against what `PROMPT.md` actually asked for. The prompt is deliberately under-specified; do not penalize either arm for not implementing things that aren't in it (e.g. "no rate limiting" is not by itself a defect — only flag if it manifests as a concrete vulnerability).
- **Don't reward one arm for trying something the other didn't attempt** unless the attempt was *correct*. A botched optimistic UI is worse than no optimistic UI. A half-baked auth layer is worse than no auth layer.
- **Treat the "least bad" verdict as binding even if both arms are objectively bad.** This is the entire point of the framing. If they're truly indistinguishable, say so explicitly and explain what would have to differ to break the tie.
- **The routing recommendation must be actionable.** Avoid "it depends" — if it depends, name the variable it depends on.

Begin by reading `PROMPT.md` and `RUBRIC.md` in full. Then proceed.
