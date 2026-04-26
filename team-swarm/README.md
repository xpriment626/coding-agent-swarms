# team-swarm (research-side)

Active development home for the H2 swarm — N homogeneous high-agency agents coordinating through peer comms over a shared Daytona workspace.

## What's special about this copy

This is the **research-side** copy. The parallel **product-side** copy lives at `~/Desktop/product-lab/pi-coral/src/team-swarm/`. They share the same code spine but are not strictly synced:

- **This repo** is allowed to be ahead, behind, or experimentally divergent. Hacky operator scripts, local frontend integrations, SQLite-logged message streams, ad-hoc test harnesses — they all belong here.
- **`pi-coral/src/team-swarm/`** must always be shippable. Productization happens by copy-paste from here once an iteration stabilizes (or the other direction when product-side updates a primitive).

See the canonical design spec at `~/Desktop/product-lab/pi-coral/docs/superpowers/specs/2026-04-26-pi-coral-mvp-design.md` for the full architecture, thesis, and build sequence.

## Status

Pre-MVP. Placeholders only — implementation begins at M1 of the build sequence.

## Structure

```
team-swarm/
├── shared/
│   └── run-agent.ts             # AI SDK loop with one tool: run_typescript
├── agent/
│   └── coral-agent.toml         # one definition; instantiated N times via session config
└── agent-bindings/
    ├── daytona.ts               # workspace I/O
    ├── team.ts                  # peer comms (no session lifecycle)
    └── exa.ts                   # research
```

## Companion: deepseek-swarm/ (the H1 baseline)

`../deepseek-swarm/` is the role-based H1 baseline (planner / implementer / reviewer). Per the spec, it's gitignored locally; revisit when running comparison studies.
