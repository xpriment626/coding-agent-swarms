// team-swarm agent runtime — code-mode loop. AI SDK + OpenRouter + bun subprocess.
//
// Spawned by Coral once per agent instance. Owns one tool exposed to the LLM:
//   run_typescript({ code }) → { stdout, stderr, exitCode }
// The subprocess (bun running a temp file) imports daytona / team bindings via
// dynamic import using BINDINGS_DIR derived from import.meta.url so cwd is
// irrelevant.

import { generateText, tool } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { spawn } from "bun";
import { mkdtempSync, writeFileSync, rmSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT_NAME = process.env.AGENT_NAME ?? "unknown-agent";
const SYSTEM_PROMPT = process.env.EXTRA_SYSTEM_PROMPT ?? "";
const INITIAL_USER_PROMPT = process.env.EXTRA_INITIAL_USER_PROMPT ?? "";
const MODEL_API_KEY = process.env.MODEL_API_KEY;
const RUN_DIR = process.env.RUN_DIR ?? "";
const MODEL_SLUG = "moonshotai/kimi-k2.6";
const SOLO_MODE = process.env.SOLO_MODE === "1";
if (!MODEL_API_KEY) throw new Error("MODEL_API_KEY not set");

// Per-iter trace JSONL — captures result.steps (reasoning + reasoningDetails +
// tool calls/results inline per step), usage, finishReason. Best-effort writer:
// a logging failure must never crash the agent.
function writeTrace(line: Record<string, unknown>): void {
  if (!RUN_DIR) return;
  try {
    const tracePath = join(RUN_DIR, "agents", `${AGENT_NAME}.jsonl`);
    mkdirSync(join(RUN_DIR, "agents"), { recursive: true });
    appendFileSync(tracePath, JSON.stringify(line) + "\n");
  } catch (e) {
    console.error(`[${AGENT_NAME}] writeTrace failed: ${(e as Error).message}`);
  }
}

const openrouter = createOpenRouter({ apiKey: MODEL_API_KEY });

// Resolve absolute path to ../agent-bindings/ at boot. The temp script imports
// bindings via dynamic import() so the cwd Coral spawned us in doesn't matter.
const BINDINGS_DIR = new URL("../agent-bindings/", import.meta.url).pathname;

const PRELUDE = `
const __bindingsDir = ${JSON.stringify(BINDINGS_DIR)};
const { daytona } = await import(__bindingsDir + "daytona.ts");
${SOLO_MODE ? "" : `const { team } = await import(__bindingsDir + "team.ts");`}
`;

async function runBunSubprocess(
  fullCode: string,
  opts: { timeoutMs: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Write to a temp file rather than `bun -e` to dodge any quoting/encoding issues
  // with large LLM-authored payloads. SIGKILL on timeout.
  const dir = mkdtempSync(join(tmpdir(), "team-swarm-tool-"));
  const file = join(dir, "tool.ts");
  writeFileSync(file, fullCode);
  try {
    const proc = spawn({
      cmd: ["bun", file],
      env: process.env as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, opts.timeoutMs);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { stdout, stderr, exitCode };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

function preview(s: string, max: number): string {
  const flat = s.replace(/\n/g, "\\n");
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

const runTypescriptTool = tool({
  description: SOLO_MODE
    ? "Execute TypeScript with bindings: daytona. Returns {stdout, stderr, exitCode}."
    : "Execute TypeScript with bindings: daytona, team. Returns {stdout, stderr, exitCode}.",
  parameters: z.object({ code: z.string() }),
  execute: async ({ code }) => {
    const callStart = Date.now();
    console.error(
      `[${AGENT_NAME}] tool_call run_typescript codeLen=${code.length} code="${preview(code, 240)}"`
    );
    // Force-exit on success too: the MCP Streamable HTTP client holds an open
    // connection that keeps the bun event loop alive even after user code
    // completes. Without an explicit process.exit(0) the subprocess hangs
    // until the SIGKILL timeout, costing ~90s per call.
    const fullCode =
      PRELUDE +
      "\n(async () => {\n" +
      code +
      "\n})().then(() => process.exit(0)).catch((e) => { console.error(e?.stack ?? e); process.exit(1); });\n";
    const result = await runBunSubprocess(fullCode, { timeoutMs: 90_000 });
    console.error(
      `[${AGENT_NAME}] tool_result exitCode=${result.exitCode} durationMs=${Date.now() - callStart} ` +
        `stdout="${preview(result.stdout, 300)}" stderr="${preview(result.stderr, 300)}"`
    );
    return result;
  },
});

async function main(): Promise<void> {
  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: INITIAL_USER_PROMPT },
  ];

  console.error(
    `[${AGENT_NAME}] booted (solo=${SOLO_MODE}), entering outer loop (RUN_DIR=${RUN_DIR || "<none>"})`
  );

  let iter = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const iterStart = Date.now();
    const result = await generateText({
      // Kimi K2.6 — Moonshot's agentic-reasoning-tuned variant. Picked over
      // K2-0905 to test whether thread-discipline failures we saw last session
      // were prompt/tool-surface-driven or model-reasoning-driven; structural
      // bind-surface fix (no team.createThread) lands at the same time.
      model: openrouter(MODEL_SLUG),
      tools: { run_typescript: runTypescriptTool },
      // maxSteps 5 × subprocess timeout 90s = 7.5min worst case per outer iter.
      // Empirically iters take 2-3min because most tool calls return well under
      // the cap. Wallclock is the outer bound; agents typically get 2+ iters.
      maxSteps: 5,
      // @ts-expect-error — ai package CoreMessage type is more permissive at runtime
      messages,
    });
    // @ts-expect-error — runtime shape includes responseMessages
    const responseMessages = result.responseMessages ?? [];
    messages.push(...responseMessages);

    // Capture per-iter reasoning trace. result.steps gives per-step text,
    // reasoning, reasoningDetails, toolCalls, toolResults — Phase 3 telemetry
    // for the FE to render later.
    writeTrace({
      ts: new Date(iterStart).toISOString(),
      agent: AGENT_NAME,
      iter,
      model: MODEL_SLUG,
      durationMs: Date.now() - iterStart,
      finishReason: result.finishReason,
      usage: result.usage,
      steps: result.steps ?? [],
      text: result.text,
    });

    console.error(
      `[${AGENT_NAME}] outer iter ${iter} complete, messages=${messages.length}, ` +
        `steps=${result.steps?.length ?? 0}, finishReason=${result.finishReason}`
    );
    iter += 1;
  }
}

main().catch((e) => {
  console.error(`[${AGENT_NAME}] fatal:`, e?.stack ?? e);
  process.exit(1);
});
