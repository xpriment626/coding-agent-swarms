import { generateText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { ClaimHandler, USD_PER_TOKEN } from './claim.ts';
import {
  createCoralResourceClient,
  createMcpClientHttp,
  injectMcpResources,
} from './coral-mcp.ts';
import { DaytonaToolbox } from './daytona.ts';
import { makeDaytonaTools } from './daytona-tools.ts';
import type { ResolvedAgentSettings } from './env.ts';
import { buildInitialUserMessage, buildSystemPrompt } from './prompts.ts';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

/**
 * One function to run any of the three swarm agents under Coral. Role
 * identity comes from each agent's coral-agent.toml (EXTRA_SYSTEM_PROMPT,
 * etc.) via `settings`. Tool surface is uniform across roles — tool
 * selection is itself the reasoning signal under test (see foundation
 * memory).
 */
export async function runSwarmAgent(settings: ResolvedAgentSettings): Promise<void> {
  if (!settings.coral) {
    throw new Error('runSwarmAgent requires Coral settings; for standalone use runSwarmAgentDev');
  }

  const provider = createOpenRouter({
    apiKey: settings.modelApiKey,
    ...(settings.modelProviderUrlOverride ? { baseURL: settings.modelProviderUrlOverride } : {}),
  });
  const model = provider(settings.modelId);

  console.log(`Connecting to Coral MCP at ${settings.coral.connectionUrl}`);
  const coralAiSdk = await createMcpClientHttp(settings.coral.connectionUrl);
  const coralResource = await createCoralResourceClient(settings.coral.connectionUrl);

  console.log(`Connecting to Exa MCP at ${EXA_MCP_URL}`);
  const exa = await createMcpClientHttp(EXA_MCP_URL, { 'x-api-key': settings.exaApiKey });

  console.log(`Attaching Daytona sandbox ${settings.daytonaSandboxId}`);
  const toolbox = new DaytonaToolbox({
    sandboxId: settings.daytonaSandboxId,
    apiKey: settings.daytonaApiKey,
  });

  const coralTools = await coralAiSdk.tools();
  const exaTools = await exa.tools();
  const daytonaTools = makeDaytonaTools(toolbox);
  const tools = { ...coralTools, ...exaTools, ...daytonaTools };

  console.log(`Available tools (${Object.keys(tools).length}): ${Object.keys(tools).join(', ')}`);

  try {
    await driveLoop({
      settings,
      model,
      tools,
      injectResources: (s) => injectMcpResources(coralResource.client, s),
    });
  } finally {
    await Promise.allSettled([coralAiSdk.close(), exa.close(), coralResource.close()]);
  }
}

/**
 * Standalone (no-Coral) entry. Connects only to OpenRouter + an inline
 * echo tool so we can verify the wire — `tool_choice: 'auto'` round-trip,
 * reasoning passthrough — without spinning up Coral or Daytona.
 */
export async function runSwarmAgentDev(settings: ResolvedAgentSettings): Promise<void> {
  const provider = createOpenRouter({
    apiKey: settings.modelApiKey,
    ...(settings.modelProviderUrlOverride ? { baseURL: settings.modelProviderUrlOverride } : {}),
  });
  const model = provider(settings.modelId);

  const { tool } = await import('ai');
  const { z } = await import('zod');
  const tools = {
    echo: tool({
      description: 'Echoes back the provided text. Use to confirm tool-call wiring.',
      inputSchema: z.object({ text: z.string().describe('Text to echo back.') }),
      execute: async ({ text }: { text: string }) => `echoed: ${text}`,
    }),
  };

  console.log(`[dev] OpenRouter model: ${settings.modelId}`);
  console.log(`[dev] Tools: ${Object.keys(tools).join(', ')}`);

  const messages: ModelMessage[] = [
    {
      role: 'user',
      content:
        'Smoke test: call the `echo` tool with text="hello deepseek-swarm" and then state in one sentence what you observed.',
    },
  ];

  const result = await generateText({
    model,
    messages,
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(4),
  });

  console.log(`[dev] steps: ${result.steps.length}`);
  for (const [i, s] of result.steps.entries()) {
    const calls = s.toolCalls?.map((c) => c.toolName).join(',') ?? '';
    console.log(`[dev] step ${i}: finishReason=${s.finishReason} tools=[${calls}]`);
  }
  console.log(`[dev] usage: ${JSON.stringify(result.usage)}`);
  console.log(`[dev] text: ${result.text}`);

  const echoCalled = result.steps.some((s) =>
    s.toolCalls?.some((c) => c.toolName === 'echo'),
  );
  if (!echoCalled) {
    throw new Error('Smoke test FAILED: model did not call the echo tool');
  }
  console.log('[dev] OK — model called echo at least once');
}

interface DriveLoopArgs {
  settings: ResolvedAgentSettings;
  model: LanguageModel;
  tools: Record<string, any>;
  injectResources: (s: string) => Promise<string>;
}

async function driveLoop(args: DriveLoopArgs): Promise<void> {
  const { settings, model, tools, injectResources } = args;
  const claim = new ClaimHandler(settings.coral);
  const messages: ModelMessage[] = [];
  let totalTokens = 0;

  for (let i = 0; i < settings.maxIterations; i++) {
    if (claim.noBudget()) {
      console.log('Budget exhausted — exiting');
      return;
    }
    if (totalTokens >= settings.maxTokens) {
      console.log(`Max tokens reached: ${totalTokens} >= ${settings.maxTokens}`);
      return;
    }
    if (i > 0 && settings.iterationDelayMs > 0) {
      await new Promise((r) => setTimeout(r, settings.iterationDelayMs));
    }

    const system = await injectResources(buildSystemPrompt(settings));
    const userText =
      i === 0 ? buildInitialUserMessage(settings) : settings.followUpUserPrompt;
    messages.push({ role: 'user', content: userText });

    try {
      const result = await generateText({
        model,
        system,
        messages,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(settings.maxStepsPerIteration),
      });

      messages.push(...result.response.messages);

      const calls = result.steps.flatMap((s) => s.toolCalls ?? []);
      console.log(
        `Iteration ${i}: ${result.steps.length} step(s), ${calls.length} tool call(s)` +
          (calls.length > 0 ? ` [${calls.map((c) => c.toolName).join(',')}]` : ''),
      );

      const tokens = result.usage?.totalTokens ?? 0;
      totalTokens += tokens;
      if (tokens > 0) {
        await claim.claim(tokens * USD_PER_TOKEN).catch((e) => {
          console.error(`Claim failed:`, e);
        });
      }
    } catch (e) {
      console.error(`Error during agent iteration ${i}:`, e);
    }
  }
}
