# telemetry-fe

SvelteKit research desk for the team-swarm telemetry data captured by `orchestration/run-swarm-task.ts`. Reads `runs/<id>/{manifest.json, transcript.jsonl, events.jsonl, final-snapshot.json}` directly from disk — no database, no API service.

## Run

```bash
cd telemetry-fe
bun install
bun run dev
```

Open http://localhost:5173/. The page lists every run found under `../runs/` (relative to `telemetry-fe/`). Click any row to view that run's transcript, event timeline, and manifest.

To point at a different runs directory:

```bash
RUNS_DIR=/absolute/path/to/runs bun run dev
```

## Pages

- `/` — run list (newest first, manifest summary, "live" badge for in-progress runs)
- `/runs/<id>` — run detail:
  - Transcript pane: chronological chat-style feed of `transcript.jsonl`, color-coded by sender
  - Event timeline (collapsed by default): full `events.jsonl` with type filter chips
  - Sidebar: manifest fields, agent list, acceptance result, errors

## Scope

This is v1 — a post-mortem viewer. Future phases (live-tail, reasoning-depth capture, file-diff timeline, cross-run comparison, pattern study) are documented in `~/.claude/projects/.../memory/vision_telemetry-fe-research-desk.md`. The data model migrates to SQLite when the JSONL approach starts to strain — also documented there.

## Stack

- SvelteKit 2 (runes mode)
- TypeScript
- `@sveltejs/adapter-auto` (works under Node for `vite dev`/`vite preview`; production deployment is out of scope)
- No UI library, no Tailwind — plain CSS in component `<style>` blocks + a small global `app.css` for tokens
