# coding-agent-swarms

Research on multi-agent coding patterns. Specifically: when you give two or more LLM coding agents a goal, a shared workspace, and a way to talk to each other, what coordination patterns produce better software, and where do they fall apart?

The repo houses several swarm shapes as sibling directories — each driving a different model or topology — and a telemetry frontend for picking through what actually happened during a run.

## What's here

```
team-swarm/         Homogeneous pair pattern (no roles, no orchestrator).
                    Current focus. N agents share one Daytona sandbox and
                    coordinate through a single Coral thread.

deepseek-swarm/     Planner / Implementer / Reviewer pattern. H1 baseline.

telemetry-fe/       SvelteKit post-mortem trace viewer. Reads runs/<id>/
                    after a session finishes; renders per-iter agent
                    reasoning, tool calls, transcript, and session events.

orchestration/      run-swarm-task.ts is the operator entry point.
                    coral-client.ts is the HTTP/WS client for Coral.
                    Sandbox lifecycle, session lifecycle, telemetry capture.

research/           Labeled experiment subfolders. Each contains the
                    median-quality prompt, scoring rubric, exported code
                    artifacts from each arm, and at least one review.

CLAUDE.md           Operator playbook. The conversational agent driving
                    the experiment reads this to know what's safe to do.
```

`runs/` is gitignored; that's the live capture target. Look in `research/` for committed experiment artifacts.

## The operator pattern

You don't really run experiments here from a shell prompt. You have a conversation with a coding agent (Claude Code or Codex), and *the agent* drives the swarm. The agent:

1. Creates a Daytona sandbox and starts a Coral session
2. Seeds the swarm with the project prompt
3. Watches the WebSocket event stream while agents work
4. Polls for an acceptance condition or wallclock
5. Exports the workspace, destroys the sandbox, writes the trace JSONL

`CLAUDE.md` is what the operator reads to understand the lifecycle, allowed HTTP targets, and cleanup contract. The interesting part of using this repo is the conversational layer — you describe an experiment, the agent designs it with you, runs it, and reports back.

If you want to drive things by hand, `orchestration/run-swarm-task.ts` is the same surface a human can call from the CLI:

```
bun orchestration/run-swarm-task.ts "<task description>"           # pair
bun orchestration/run-swarm-task.ts --solo "<task description>"    # single
```

## Telemetry frontend

After a run finishes, every artifact lands in `runs/<timestamp>-<sandbox-id>/`. To browse it:

```
cd telemetry-fe
bun run dev
```

Defaults to `http://localhost:5173`. The list page shows all runs with model filter chips; clicking one opens the per-iter reasoning timeline alongside the inter-agent transcript and the raw session event stream. Phase 1 (post-mortem viewer) is what's shipped; live-tail and cross-run comparison are tracked as future phases.

## A worked example

[`research/2026-04-28-pair-vs-single-median-prompt/`](research/2026-04-28-pair-vs-single-median-prompt/) contains a complete experiment cycle:

- `PROMPT.md` — a 50th-percentile-user URL-shortener prompt fed to both arms (Kimi K2.6, 20-min wallclock)
- `RUBRIC.md` — 8 scoring dimensions plus task-specific danger zones (open redirect, counter race, slug strategy, etc.)
- `pair/<run-id>/{code,trace}/` and `single/<run-id>/{code,trace}/` — exported artifacts and per-iter reasoning JSONL from each arm
- `REVIEW.md` — GPT-5.5 acting as impartial reviewer, scoring artifacts only
- `REVIEW-CORAL.md` — Coral-context failure-mode analysis, attributing observed coordination breakdowns to specific binding/prompt/runtime layers

The headline finding: the pair arm collapsed at iter 0 because one agent omitted the optional `mentions` arg on `team.post`, the binding's mention-filter silenced those messages for the other agent, and from there both agents fell back to coordinating through filesystem state instead of the thread. Reading the two REVIEW files together is a reasonable orientation to what kinds of patterns this work surfaces.

## External dependencies

The swarms depend on services that need API keys (none of which are in the repo):

- **Coral** — local server, started via `npx coralos-dev@latest`. Requires JDK 25 (Coral's class file version is 68 — JDK 21 will throw `UnsupportedClassVersionError`).
- **Daytona** — sandbox provisioning. `DAYTONA_API_KEY` in `.env`.
- **OpenRouter** — model access (Kimi, DeepSeek, etc.). `OPENROUTER_API_KEY` in `.env`.
- **Exa** — research tool available to agents. `EXA_API_KEY` in `.env`.

`.env.example` is the template. Coral is the only service that runs locally; everything else is HTTPS.

## Status

This is a research repo, not a product. Expectations:

- Master is the working branch. Commits land directly. No PR process.
- Patterns evolve as experiments produce findings. The README and `CLAUDE.md` may lag.
- `docs/` is gitignored — that's where in-flight specs and plans live; they don't survive across sessions in a useful way once the work lands.
- Memory about the substrate (Coral, Daytona, Koog era patterns) lives in the operator's per-project memory under `~/.claude/projects/.../memory/`, not in the repo. The traces, reviews, and code in `research/` are the durable artifacts.
