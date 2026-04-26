// team binding — peer comms via Coral as the calling agent. Research-side copy.
// Parallel of pi-coral/src/team-swarm/agent-bindings/team.ts; allowed to diverge.
//
// Loaded inside the `bun -e` subprocess.
//
// API (comms-ONLY — no session lifecycle):
//   team.post(thread, content, mentions?): Promise<void>
//   team.wait(opts?: { thread?, mentions?, timeoutMs? }): Promise<Message[]>   // blocking
//   team.threads(): Promise<Thread[]>
//   team.createThread(name, participants): Promise<Thread>
//   team.agents(): Promise<{ name, description }[]>
//
// Notably absent: team.close() / team.endSession(). Closure is operator-side, not agent-side.
//
// Reads CORAL_AGENT_SECRET + AGENT_NAME from env. wait() blocks the subprocess
// until message arrives or timeout — wallclock is bounded by run_typescript's outer timeout.
//
// Research-side note: this binding is the natural integration point for piping
// every send/receive event into the local SQLite store for offline reasoning analysis.

export {};
