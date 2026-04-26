// daytona binding — workspace I/O via HTTP to Daytona toolbox proxy. Research-side copy.
// Parallel of pi-coral/src/team-swarm/agent-bindings/daytona.ts; allowed to diverge.
//
// Loaded inside the `bun -e` subprocess spawned by run_typescript.
//
// API:
//   daytona.read(path): Promise<string>
//   daytona.write(path, content): Promise<void>
//   daytona.exec(command, opts?): Promise<{ stdout, stderr, exitCode }>
//   daytona.list(path): Promise<string[]>
//
// Reads DAYTONA_API_KEY + sandbox id from env. Throws on non-2xx (no silent failures).
// See foundation memory (foundation_coral-koog-swarm-patterns.md) for endpoint shapes
// + auth-header gotchas — this binding's HTTP shape is shared between both repos.

export {};
