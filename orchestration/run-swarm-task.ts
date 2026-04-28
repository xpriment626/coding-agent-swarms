#!/usr/bin/env bun
// Layer 2 composer for the team-swarm vertical slice. Drives:
//   sandbox create → prewarm → Coral session → team-room thread → WS subscribe
//   → wait-loop until accept(sandbox)==true OR wallclock → snapshot → cleanup
//
// Cleanup runs in finally and is non-negotiable. Sandbox leak verification
// after destroy. SIGINT/SIGTERM handlers force the same cleanup path.

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createSandbox,
  destroySandbox,
  verifySandboxGone,
  prewarmWorkspace,
  exec,
  createSession,
  getSessionSnapshot,
  subscribeSessionEvents,
  puppetCreateThread,
  puppetSendMessage,
  puppetForceEndRuntime,
} from "./coral-client.ts";
import type {
  AgentInstanceSpec,
  SessionAgentSpec,
  SessionEvent,
  SessionSpec,
  TaskResult,
} from "./types.ts";

type RunOptions = {
  accept?: (sandboxId: string, state: WaitState) => Promise<boolean>;
  maxWallClockMs?: number;
  teamContext?: boolean;
  runDir?: string;
  solo?: boolean;
};

type WaitState = Map<string, "waiting" | "active" | "stopped">;

const DEFAULT_INSTANCES: AgentInstanceSpec[] = [{ name: "agent-A" }, { name: "agent-B" }];
// Model label — kept in sync with the literal in team-swarm/shared/run-agent.ts.
const DEFAULT_MODEL = "moonshotai/kimi-k2.6";

// System prompt for --solo runs. Replaces the team-shaped default declared in
// coral-agent.toml. Keeps the run_typescript / daytona binding framing; drops
// everything about team-room, peer comms, kick-off, thread discipline.
const SOLO_SYSTEM_PROMPT = `You are an engineer working solo in a Daytona workspace at /workspace.

# Your only tool

You have exactly ONE tool: \`run_typescript({ code: string })\`. It executes
TypeScript in a Bun subprocess and returns \`{ stdout, stderr, exitCode }\`.
Every action you want to take — reading or writing files in the sandbox,
running shell commands — is done by writing TypeScript inside the \`code\`
argument and calling \`run_typescript\`.

There is NO separate \`daytona\` tool. It is a JavaScript identifier
available inside \`code\`, not a tool you can call directly.

# Bindings available inside \`code\`

One pre-loaded object:

\`\`\`ts
// Workspace I/O — operates on /workspace in your Daytona sandbox.
daytona.read(path: string): Promise<string>
daytona.write(path: string, content: string): Promise<void>
daytona.exec(cmd: string, opts?: { cwd?: string; timeout?: number }): Promise<{stdout, stderr, exitCode}>
daytona.list(path: string): Promise<string[]>
\`\`\`

# Approach

Done-ness is judged by an external review of what you produce in /workspace.
Work iteratively — write code, run it, fix what's broken, then move on.
Do not ask for confirmation between steps; just keep working until the
external reviewer would consider the artifact in /workspace complete.`;

function timestampPrefix(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function buildSeed(
  task: string,
  selfName: string,
  peerNames: string[],
  teamContext: boolean
): string {
  if (!teamContext) return `You've been hired to: ${task}.`;
  return (
    `You're an engineer named ${selfName} on a team that's been hired to: ${task}. ` +
    `Your teammates are ${peerNames.join(", ")}. Coordinate in thread \`team-room\`.`
  );
}

function buildSessionSpec(
  task: string,
  instances: AgentInstanceSpec[],
  sandboxId: string,
  teamContext: boolean,
  runDirAbs: string,
  solo: boolean
): SessionSpec {
  const requireEnvVar = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
  };
  const modelKey = requireEnvVar("OPENROUTER_API_KEY");
  const daytonaKey = requireEnvVar("DAYTONA_API_KEY");

  const engineerAgents: SessionAgentSpec[] = instances.map((inst) => {
    const peers = instances.filter((i) => i.name !== inst.name).map((i) => i.name);
    return {
      id: { name: "engineer", version: "0.1.0", registrySourceId: { type: "local" as const } },
      name: inst.name,
      description: "",
      provider: { type: "local" as const, runtime: "executable" as const },
      blocking: false as const,
      customToolAccess: [] as [],
      plugins: [] as [],
      x402Budgets: [] as [],
      options: {
        EXTRA_INITIAL_USER_PROMPT: {
          type: "string" as const,
          value: buildSeed(task, inst.name, peers, teamContext),
        },
        AGENT_NAME: { type: "string" as const, value: inst.name },
        MODEL_API_KEY: { type: "string" as const, value: modelKey },
        DAYTONA_API_KEY: { type: "string" as const, value: daytonaKey },
        DAYTONA_SANDBOX_ID: { type: "string" as const, value: sandboxId },
        RUN_DIR: { type: "string" as const, value: runDirAbs },
        ...(solo
          ? {
              SOLO_MODE: { type: "string" as const, value: "1" },
              EXTRA_SYSTEM_PROMPT: {
                type: "string" as const,
                value: SOLO_SYSTEM_PROMPT,
              },
            }
          : {}),
      },
    };
  });

  // Required for the puppet REST endpoints (/api/v1/puppet/...). Server impersonates
  // this agent when the operator drives threads/messages from outside.
  const puppetAgent: SessionAgentSpec = {
    id: { name: "puppet", version: "1.0.0", registrySourceId: { type: "local" as const } },
    name: "puppet",
    description: "",
    provider: { type: "local" as const, runtime: "prototype" as const },
    blocking: false as const,
    customToolAccess: [] as [],
    plugins: [] as [],
    x402Budgets: [] as [],
    options: {},
  };

  return {
    agentGraphRequest: {
      agents: [...engineerAgents, puppetAgent],
      groups: [],
      customTools: {},
    },
    namespaceProvider: {
      type: "create_if_not_exists",
      namespaceRequest: { name: "default", annotations: {}, deleteOnLastSessionExit: false },
    },
    execution: {
      mode: "immediate",
      runtimeSettings: { extendedEndReport: false, ttl: 50_000_000 },
    },
  };
}

export async function runSwarmTask(input: {
  task: string;
  instances?: AgentInstanceSpec[];
  options?: RunOptions;
}): Promise<TaskResult> {
  const startedAt = Date.now();
  const instances =
    input.instances ?? (input.options?.solo ? [{ name: "agent" }] : DEFAULT_INSTANCES);
  const opts: Required<Omit<RunOptions, "accept">> & { accept?: RunOptions["accept"] } = {
    maxWallClockMs: input.options?.maxWallClockMs ?? 300_000,
    teamContext: input.options?.solo ? false : (input.options?.teamContext ?? true),
    runDir: input.options?.runDir ?? "",
    solo: input.options?.solo ?? false,
    accept: input.options?.accept,
  };

  const errors: string[] = [];
  const waitState: WaitState = new Map(instances.map((i) => [i.name, "active" as const]));
  let sandboxId: string | undefined;
  let ns: string | undefined;
  let sid: string | undefined;
  let ws: { close: () => void } | undefined;
  let runDir = opts.runDir;
  let acceptanceResult: { passed: boolean } | undefined;
  let exitReason: TaskResult["exitReason"] = "error";

  const cleanup = async (): Promise<void> => {
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        errors.push(`ws.close: ${(e as Error).message}`);
      }
    }
    if (ns && sid) {
      try {
        await puppetForceEndRuntime(ns, sid);
      } catch (e) {
        errors.push(`puppetForceEndRuntime: ${(e as Error).message}`);
      }
    }
    if (sandboxId) {
      // Export /workspace before destroying — sandbox death = artifact loss.
      // Failure logs to errors[] but does NOT block destroy: leak avoidance
      // outranks artifact retrieval (per orchestrator-cleanup-discipline rule).
      // Resolve script path via import.meta.url so cwd is irrelevant — same
      // pattern as BINDINGS_DIR in run-agent.ts.
      const exportScript = new URL("./export-sandbox.sh", import.meta.url).pathname;
      try {
        const proc = Bun.spawn({
          cmd: [exportScript, sandboxId],
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text();
          errors.push(`export-sandbox.sh exit=${exitCode}: ${stderr.slice(0, 500)}`);
        } else {
          const stdout = await new Response(proc.stdout).text();
          const m = stdout.match(/output: (.+)/);
          if (m && m[1]) console.error(`[runner] workspace exported to ${m[1].trim()}`);
        }
      } catch (e) {
        errors.push(`export-sandbox.sh spawn: ${(e as Error).message}`);
      }

      try {
        await destroySandbox(sandboxId);
      } catch (e) {
        errors.push(`destroySandbox: ${(e as Error).message}`);
      }
      const gone = await verifySandboxGone(sandboxId).catch(() => false);
      if (!gone) {
        errors.push(`LEAKED SANDBOX: ${sandboxId}`);
        console.error(`WARN: leaked sandbox ${sandboxId} — manual cleanup required`);
      }
    }
  };

  const onSignal = (sig: string): void => {
    console.error(`\n[runner] received ${sig}, cleaning up...`);
    cleanup().finally(() => process.exit(130));
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  try {
    // Step 1: sandbox
    ({ sandboxId } = await createSandbox());
    console.error(`[runner] sandbox=${sandboxId}`);

    // Step 2: prewarm
    await prewarmWorkspace(sandboxId);

    // Step 2b: resolve runDir to absolute path BEFORE session create.
    // Agents need RUN_DIR injected via session options at spawn time so they
    // can write per-iter reasoning traces to runs/<id>/agents/<name>.jsonl.
    // Suffix uses sandboxId.slice(0,8) instead of sid.slice(0,8) because the
    // session id only exists after createSession — chicken-and-egg.
    if (!runDir) runDir = `runs/${timestampPrefix()}-${sandboxId.slice(0, 8)}`;
    const runDirAbs = resolve(process.cwd(), runDir);
    mkdirSync(join(runDirAbs, "agents"), { recursive: true });

    // Step 3: session
    const spec = buildSessionSpec(
      input.task,
      instances,
      sandboxId,
      opts.teamContext,
      runDirAbs,
      opts.solo
    );
    ({ namespace: ns, sessionId: sid } = await createSession(spec));
    console.error(`[runner] session=${ns}/${sid}`);

    // Step 4 + 4b: team-room thread + kick-off — only in pair (multi-agent) mode.
    // Solo doesn't need a coordination thread; its task arrives via
    // EXTRA_INITIAL_USER_PROMPT at session create.
    if (!opts.solo) {
      // Step 4: team-room thread (with one retry).
      // Puppet must be in participants — it's the implicit sender for any
      // messages we drive from the operator side.
      let teamRoomThreadId: string | undefined;
      const tryCreateThread = async (): Promise<string> => {
        const { threadId } = await puppetCreateThread(ns!, sid!, "team-room", [
          ...instances.map((i) => i.name),
          "puppet",
        ]);
        return threadId;
      };
      try {
        teamRoomThreadId = await tryCreateThread();
      } catch (e) {
        console.error(
          `[runner] puppetCreateThread first attempt failed: ${(e as Error).message}; retrying in 100ms`
        );
        await new Promise((r) => setTimeout(r, 100));
        teamRoomThreadId = await tryCreateThread();
      }
      console.error(`[runner] team-room created: ${teamRoomThreadId}`);

      // Step 4b: kick-off message. Agents need the thread UUID to post back
      // (coral_send_message uses threadId, not threadName). The seed prompt is
      // fixed at session create — too early to know the threadId. So the puppet
      // posts a kick-off mentioning every engineer; their first team.wait()
      // surfaces this message, from which they can read message.threadId.
      await puppetSendMessage(
        ns!,
        sid!,
        teamRoomThreadId!,
        `Welcome team. The task: ${input.task}\n\nThis thread (\`team-room\`) is your shared coordination channel — its id is in this message's metadata. Use team.wait() to receive teammate replies, team.post(threadId, ...) to send.`,
        instances.map((i) => i.name)
      );
      console.error(`[runner] kick-off message posted`);
    }

    // Step 5: manifest (runDir + agents/ already created in step 2b)
    const manifest = {
      namespace: ns,
      sessionId: sid,
      sandboxId,
      instances: instances.map((i) => ({ name: i.name, model: DEFAULT_MODEL })),
      startedAt: new Date(startedAt).toISOString(),
    };
    writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const eventsPath = join(runDir, "events.jsonl");
    const transcriptPath = join(runDir, "transcript.jsonl");

    // Step 6: WS subscription
    ws = subscribeSessionEvents(ns, sid, (e: SessionEvent) => {
      try {
        appendFileSync(eventsPath, JSON.stringify(e) + "\n");
      } catch (err) {
        errors.push(`events.jsonl append: ${(err as Error).message}`);
      }
      if (e.type === "thread_message_sent" && e.message) {
        const m = e.message;
        const denorm = {
          at: m.timestamp,
          sender: m.senderName,
          thread: m.threadId,
          text: m.text,
          mentions: m.mentionNames,
          messageId: m.id,
        };
        try {
          appendFileSync(transcriptPath, JSON.stringify(denorm) + "\n");
        } catch (err) {
          errors.push(`transcript.jsonl append: ${(err as Error).message}`);
        }
      }
      // Only track wait state for engineer instances (puppet is virtual; ignore).
      if (e.type === "agent_wait_start" && e.name && waitState.has(e.name)) {
        waitState.set(e.name, "waiting");
      }
      if (e.type === "agent_wait_stop" && e.name && waitState.has(e.name)) {
        waitState.set(e.name, "active");
      }
      if (
        e.type === "thread_message_sent" &&
        e.message?.senderName &&
        waitState.has(e.message.senderName)
      ) {
        waitState.set(e.message.senderName, "active");
      }
      // Engineer agent process died (crash, billing, etc.).
      if (e.type === "runtime_stopped" && e.name && waitState.has(e.name)) {
        waitState.set(e.name, "stopped");
      }
      // Pretty-print to stdout for live operator visibility
      const ts = e.timestamp ?? new Date().toISOString();
      if (e.type === "thread_message_sent" && e.message) {
        console.log(
          `[${ts}] ${e.message.senderName} → ${e.message.threadId}: ${e.message.text.slice(0, 200)}`
        );
      } else {
        console.log(`[${ts}] ${e.type}${e.name ? ` (${e.name})` : ""}`);
      }
    });

    // Step 7: stop polling loop.
    // Acceptance is polled independently of agent state — agents inside
    // run_typescript don't emit Coral's native agent_wait_* events (the wait
    // is an MCP tool call, not the runtime), so a "all-waiting" gate would
    // never trigger. Poll the sandbox for the acceptance condition every 5s.
    const accept =
      opts.accept ?? (opts.solo ? (async (): Promise<boolean> => false) : defaultAccept);
    while (true) {
      await new Promise((r) => setTimeout(r, 5_000));
      if (Date.now() - startedAt > opts.maxWallClockMs) {
        exitReason = "wallclock";
        acceptanceResult = { passed: false };
        break;
      }
      const states = Array.from(waitState.values());
      // Bail early if every engineer agent has died — nothing left to wait for.
      if (states.length > 0 && states.every((v) => v === "stopped")) {
        errors.push("all engineer agents stopped before acceptance — see Coral logs");
        exitReason = "error";
        acceptanceResult = { passed: false };
        break;
      }
      const passed = await accept(sandboxId, waitState).catch((e) => {
        errors.push(`accept: ${(e as Error).message}`);
        return false;
      });
      if (passed) {
        exitReason = "accepted";
        acceptanceResult = { passed: true };
        break;
      }
    }

    // Step 8: snapshot
    try {
      const snap = await getSessionSnapshot(ns, sid);
      writeFileSync(join(runDir, "final-snapshot.json"), JSON.stringify(snap, null, 2));
    } catch (e) {
      errors.push(`getSessionSnapshot: ${(e as Error).message}`);
    }
  } catch (e) {
    errors.push(`fatal: ${(e as Error).stack ?? (e as Error).message}`);
    exitReason = "error";
  } finally {
    await cleanup();
    if (runDir) {
      try {
        const finalManifest = {
          namespace: ns,
          sessionId: sid,
          sandboxId,
          instances: instances.map((i) => ({ name: i.name, model: DEFAULT_MODEL })),
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          exitReason,
          acceptanceResult,
          errors,
        };
        writeFileSync(join(runDir, "manifest.json"), JSON.stringify(finalManifest, null, 2));
      } catch (e) {
        console.error(`manifest update failed: ${(e as Error).message}`);
      }
    }
  }

  return {
    exitReason,
    acceptanceResult,
    durationMs: Date.now() - startedAt,
    runDir: runDir ?? "",
    errors,
  };
}

// Smoke-task-specific default acceptance: SUMMARY.md exists in /workspace.
// Override via options.accept for non-smoke uses.
async function defaultAccept(sandboxId: string, _state: WaitState): Promise<boolean> {
  const r = await exec(sandboxId, "test -f /workspace/SUMMARY.md && echo OK || echo MISSING", {
    timeout: 10,
  });
  return r.exitCode === 0 && r.stdout.includes("OK");
}

// CLI entry
if (import.meta.main) {
  const args = process.argv.slice(2);
  const solo = args.includes("--solo");
  const task = args.filter((a) => a !== "--solo").join(" ").trim();
  if (!task) {
    console.error(
      'usage: bun orchestration/run-swarm-task.ts [--solo] "<task description>"'
    );
    console.error("env: MAX_WALLCLOCK_MS (default 300000)");
    process.exit(2);
  }
  const maxWallClockMs = process.env.MAX_WALLCLOCK_MS
    ? parseInt(process.env.MAX_WALLCLOCK_MS, 10)
    : undefined;
  const result = await runSwarmTask({ task, options: { maxWallClockMs, solo } });
  console.error(
    `\n[runner] DONE — exitReason=${result.exitReason} durationMs=${result.durationMs} runDir=${result.runDir} solo=${solo}`
  );
  if (result.errors.length) {
    console.error(`[runner] errors:`);
    for (const e of result.errors) console.error(`  - ${e}`);
  }
  process.exit(result.exitReason === "accepted" ? 0 : 1);
}
