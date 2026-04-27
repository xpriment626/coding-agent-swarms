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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT_NAME = process.env.AGENT_NAME ?? "unknown-agent";
const SYSTEM_PROMPT = process.env.EXTRA_SYSTEM_PROMPT ?? "";
const INITIAL_USER_PROMPT = process.env.EXTRA_INITIAL_USER_PROMPT ?? "";
const MODEL_API_KEY = process.env.MODEL_API_KEY;
if (!MODEL_API_KEY) throw new Error("MODEL_API_KEY not set");

const openrouter = createOpenRouter({ apiKey: MODEL_API_KEY });

// Resolve absolute path to ../agent-bindings/ at boot. The temp script imports
// bindings via dynamic import() so the cwd Coral spawned us in doesn't matter.
const BINDINGS_DIR = new URL("../agent-bindings/", import.meta.url).pathname;

const PRELUDE = `
const __bindingsDir = ${JSON.stringify(BINDINGS_DIR)};
const { daytona } = await import(__bindingsDir + "daytona.ts");
const { team } = await import(__bindingsDir + "team.ts");
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

const runTypescriptTool = tool({
  description:
    "Execute TypeScript with bindings: daytona, team. Returns {stdout, stderr, exitCode}.",
  parameters: z.object({ code: z.string() }),
  execute: async ({ code }) => {
    const fullCode =
      PRELUDE +
      "\nawait (async () => {\n" +
      code +
      "\n})().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });\n";
    return await runBunSubprocess(fullCode, { timeoutMs: 90_000 });
  },
});

async function main(): Promise<void> {
  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: INITIAL_USER_PROMPT },
  ];

  console.error(`[${AGENT_NAME}] booted, entering outer loop`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await generateText({
      // Temporary swap: `deepseek/deepseek-v4-flash` is currently unusable for
      // tool-calling — DeepSeek upstream is degraded (status:-5, 0% 30m uptime)
      // and DeepInfra (the only other tool-capable provider) is rate-limiting
      // OpenRouter's shared pool with HTTP 429. Kimi K2-0905 is auto-routed to
      // Novita with tools support and is verified working in this account.
      // Revert target: 2026-04-29. See feedback_openrouter-deepseek-blacklist.md.
      model: openrouter("moonshotai/kimi-k2-0905"),
      tools: { run_typescript: runTypescriptTool },
      maxSteps: 10,
      // @ts-expect-error — ai package CoreMessage type is more permissive at runtime
      messages,
    });
    // @ts-expect-error — runtime shape includes responseMessages
    const responseMessages = result.responseMessages ?? [];
    messages.push(...responseMessages);
    console.error(`[${AGENT_NAME}] outer iter complete, messages=${messages.length}`);
  }
}

main().catch((e) => {
  console.error(`[${AGENT_NAME}] fatal:`, e?.stack ?? e);
  process.exit(1);
});
