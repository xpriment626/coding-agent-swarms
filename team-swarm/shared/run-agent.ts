// The team-swarm agent runtime — code-mode loop. Research-side copy.
//
// This file is the parallel of pi-coral/src/team-swarm/shared/run-agent.ts.
// Allowed to diverge while iterating against research-side tooling
// (local frontend, SQLite logger, etc.); reconcile when productizing.
//
// Each agent instance runs this entry point as a subprocess spawned by Coral.
// AI SDK loop with ONE tool exposed to the LLM:
//
//   run_typescript({ code: string }): { stdout, stderr, exitCode }
//
// Implementation:
//   - spawn('bun', ['-e', PRELUDE + code], { timeout: 30_000 })
//   - PRELUDE imports daytona / team / exa from ../agent-bindings/
//   - subprocess inherits env: AGENT_NAME, CORAL_AGENT_SECRET, DAYTONA_API_KEY, EXA_API_KEY
//   - SIGKILL on timeout; collect stdout/stderr; return result to LLM
//
// No role-prescription. Identity is just the instance name (agent-A, agent-B, ...).
// Closure is operator-side: the agent has no team.close() / coral_close_session.

export {};
