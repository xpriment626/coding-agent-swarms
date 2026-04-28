# Run manifest — 2026-04-28 pair-vs-single URL-shortener experiment

Both arms ran the prompt in `PROMPT.md` against Kimi K2.6, 20-minute wallclock budget, no acceptance gate (both exited on `wallclock`). 0 errors in either manifest. Both sandboxes destroyed cleanly.

## Solo arm

- Run directory (manifest, events.jsonl, transcript.jsonl, agents/agent.jsonl): `runs/20260428-201631-990c5bb8/`
- Workspace export (the code GPT-5.5 reviews): `/Users/bambozlor/Desktop/sandbox-out/20260428-203631/`
- Outer iters captured: 10 (1.4MB trace)
- Source files produced: `package.json`, `bun.lock`, `src/index.ts`, `src/server.ts`, `src/db.ts`, `src/shortener.ts`, `src/utils.ts`, `src/html.ts`, `tests/app.test.ts`

## Pair arm

- Run directory (manifest, events.jsonl, transcript.jsonl, agents/agent-A.jsonl, agent-B.jsonl): `runs/20260428-203716-c04e2736/`
- Workspace export: `/Users/bambozlor/Desktop/sandbox-out/20260428-205719/`
- Outer iters captured: agent-A 10 (555KB), agent-B 9 (462KB)
- Coordination messages exchanged: **3 messages in 20min** — worth a look in the trace
- Source files produced: `package.json`, `bun.lock`, `src/server.ts`, `src/db.ts`, `public/index.html`, `public/style.css`, `public/app.js`, `links.db`

## Cross-arm differences worth flagging to the reviewer

| | Solo | Pair |
|---|---|---|
| Source files | 9 (incl. tests) | 8 (no tests) |
| Frontend approach | Server-rendered (`src/html.ts`) | Static frontend (`public/*`) |
| Tests present | Yes (`tests/app.test.ts`) | No |
| Persistence file in workspace | No (DB likely not exercised before export) | Yes (`links.db` present) |

These are observational, not value judgments — the GPT-5.5 review applies the rubric in `RUBRIC.md`.

## To run the GPT-5.5 review

Copy the artifacts into the review structure:

```bash
# Solo
mkdir -p research/2026-04-28-pair-vs-single-median-prompt/single/20260428-201631-990c5bb8/{code,trace}
cp -r /Users/bambozlor/Desktop/sandbox-out/20260428-203631/* research/2026-04-28-pair-vs-single-median-prompt/single/20260428-201631-990c5bb8/code/
cp -r runs/20260428-201631-990c5bb8/* research/2026-04-28-pair-vs-single-median-prompt/single/20260428-201631-990c5bb8/trace/

# Pair
mkdir -p research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/{code,trace}
cp -r /Users/bambozlor/Desktop/sandbox-out/20260428-205719/* research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/code/
cp -r runs/20260428-203716-c04e2736/* research/2026-04-28-pair-vs-single-median-prompt/pair/20260428-203716-c04e2736/trace/
```

(Or drag manually if you prefer — Finder works too.)

Then paste the prompt in `REVIEW-INVOCATION.md` into Codex (GPT-5.5), substituting:

- `<PAIR_RUN_ID>` → `20260428-203716-c04e2736`
- `<SINGLE_RUN_ID>` → `20260428-201631-990c5bb8`
