#!/usr/bin/env bun
// Layer 2 composer for the team-swarm vertical slice. Drives:
//   sandbox create → prewarm → Coral session → team-room thread → WS subscribe
//   → wait-loop until accept(sandbox)==true OR wallclock → snapshot → cleanup
//
// Cleanup runs in finally and is non-negotiable. Sandbox leak verification
// after destroy. SIGINT/SIGTERM handlers force the same cleanup path.

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  puppetForceEndRuntime,
} from "./coral-client.ts";
import type {
  AgentInstanceSpec,
  SessionEvent,
  SessionSpec,
  TaskResult,
} from "./types.ts";

type RunOptions = {
  accept?: (sandboxId: string, state: WaitState) => Promise<boolean>;
  maxWallClockMs?: number;
  teamContext?: boolean;
  runDir?: string;
};

type WaitState = Map<string, "waiting" | "active">;

const DEFAULT_INSTANCES: AgentInstanceSpec[] = [{ name: "agent-A" }, { name: "agent-B" }];
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

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
  teamContext: boolean
): SessionSpec {
  const requireEnvVar = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
  };
  const modelKey = requireEnvVar("OPENROUTER_API_KEY");
  const daytonaKey = requireEnvVar("DAYTONA_API_KEY");

  const agents = instances.map((inst) => {
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
      },
    };
  });

  return {
    agentGraphRequest: {
      agents,
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
  const instances = input.instances ?? DEFAULT_INSTANCES;
  const opts: Required<Omit<RunOptions, "accept">> & { accept?: RunOptions["accept"] } = {
    maxWallClockMs: input.options?.maxWallClockMs ?? 300_000,
    teamContext: input.options?.teamContext ?? true,
    runDir: input.options?.runDir ?? "",
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

    // Step 3: session
    const spec = buildSessionSpec(input.task, instances, sandboxId, opts.teamContext);
    ({ namespace: ns, sessionId: sid } = await createSession(spec));
    console.error(`[runner] session=${ns}/${sid}`);

    // Step 4: team-room thread (with one retry)
    const tryCreateThread = async (): Promise<void> => {
      await puppetCreateThread(
        ns!,
        sid!,
        "team-room",
        instances.map((i) => i.name)
      );
    };
    try {
      await tryCreateThread();
    } catch (e) {
      console.error(
        `[runner] puppetCreateThread first attempt failed: ${(e as Error).message}; retrying in 100ms`
      );
      await new Promise((r) => setTimeout(r, 100));
      await tryCreateThread();
    }
    console.error(`[runner] team-room created`);

    // Step 5: run dir + manifest
    if (!runDir) runDir = `runs/${timestampPrefix()}-${sid.slice(0, 8)}`;
    mkdirSync(runDir, { recursive: true });
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
      if (e.type === "agent_wait_start" && e.name) waitState.set(e.name, "waiting");
      if (e.type === "agent_wait_stop" && e.name) waitState.set(e.name, "active");
      if (e.type === "thread_message_sent" && e.message?.senderName) {
        waitState.set(e.message.senderName, "active");
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

    // Step 7: stop polling loop
    const accept = opts.accept ?? defaultAccept;
    while (true) {
      await new Promise((r) => setTimeout(r, 5_000));
      if (Date.now() - startedAt > opts.maxWallClockMs) {
        exitReason = "wallclock";
        acceptanceResult = { passed: false };
        break;
      }
      const allWaiting = Array.from(waitState.values()).every((v) => v === "waiting");
      if (allWaiting) {
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
  const task = process.argv.slice(2).join(" ").trim();
  if (!task) {
    console.error('usage: bun orchestration/run-swarm-task.ts "<task description>"');
    process.exit(2);
  }
  const result = await runSwarmTask({ task });
  console.error(
    `\n[runner] DONE — exitReason=${result.exitReason} durationMs=${result.durationMs} runDir=${result.runDir}`
  );
  if (result.errors.length) {
    console.error(`[runner] errors:`);
    for (const e of result.errors) console.error(`  - ${e}`);
  }
  process.exit(result.exitReason === "accepted" ? 0 : 1);
}
