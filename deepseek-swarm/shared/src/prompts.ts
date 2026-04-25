import type { ResolvedAgentSettings } from './env.ts';

/**
 * The base system prompt is the role-agnostic shell with Coral resource
 * placeholders. It gets re-rendered each iteration via `injectMcpResources`
 * so the LLM sees fresh `coral://state` on every turn.
 */
export function buildSystemPrompt(settings: ResolvedAgentSettings): string {
  const parts = [settings.systemPrompt.trim()];
  const extra = settings.extraSystemPrompt.trim();
  if (extra.length > 0) {
    parts.push('', extra);
  }
  return parts.join('\n');
}

/**
 * Iteration-0 user message. Baseline says *consider* waiting for mentions
 * — a suggestion, not a command (some models self-start, see foundation
 * memory). Per-agent EXTRA_INITIAL_USER_PROMPT is empty by convention so
 * the puppet-seeded message drives the first real work.
 */
export function buildInitialUserMessage(settings: ResolvedAgentSettings): string {
  const lines: string[] = [];
  lines.push(
    '[automated message] You are an autonomous agent designed to assist users by collaborating with other agents. ' +
      'Your goal is to fulfill user requests to the best of your ability using the tools and resources available to you. ' +
      'If no instructions are provided, consider waiting for mentions until another agent provides further direction.',
  );
  const extra = settings.extraInitialUserPrompt.trim();
  if (extra.length > 0) {
    lines.push('Here are some additional instructions to guide your behavior:');
    lines.push('<specific instructions>');
    lines.push(extra);
    lines.push('</specific instructions>');
  }
  lines.push(
    "Remember that 'I' am not the user, who is not directly reachable. " +
      'Use tools to interact with other agents as necessary to fulfil the user’s needs. ' +
      'You will receive further automated messages this way.',
  );
  return lines.join('\n');
}
