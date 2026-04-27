// team binding — peer comms via Coral MCP. Loaded inside the run_typescript subprocess.
//
// Uses CORAL_CONNECTION_URL injected by Coral (Streamable HTTP MCP endpoint).
// Self-mentions are filtered before send (server silently drops them).
// wait() maintains a per-process watermark and uses replayAfter to dodge the
// `coral_wait_for_message` darkpool race.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type TeamMessage = {
  id: string;
  senderName: string;
  text: string;
  timestamp: string;
  threadId: string;
  mentionNames: string[];
};

export type TeamThread = { id: string; name: string; participants: string[] };
export type TeamAgent = { name: string; description: string };

let client: Client | null = null;

function agentName(): string {
  const n = process.env.AGENT_NAME;
  if (!n) throw new Error("AGENT_NAME not set");
  return n;
}

async function getClient(): Promise<Client> {
  if (client) return client;
  const url = process.env.CORAL_CONNECTION_URL;
  if (!url) throw new Error("CORAL_CONNECTION_URL not set");
  const c = new Client({ name: `team-binding-${agentName()}`, version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await c.connect(transport);
  client = c;
  return c;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const c = await getClient();
  const result = await c.callTool({ name, arguments: args });
  return result.content;
}

function parseToolResult(content: unknown): unknown {
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as { type?: string; text?: string };
  if (first.type !== "text" || !first.text) return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

export const team = {
  async post(thread: string, content: string, mentions: string[] = []): Promise<void> {
    const self = agentName();
    const filteredMentions = mentions.filter((m) => m !== self);
    await callTool("coral_send_message", {
      threadId: thread,
      content,
      mentions: filteredMentions,
    });
  },

  // Blocks until the next message addressed to this agent arrives, OR until
  // maxWaitMs elapses. Returns the message (or null on timeout). Coral's
  // coral_wait_for_message uses currentUnixTime as the watermark — anything
  // older than that is filtered out, dodging the darkpool race.
  async wait(opts?: { timeoutMs?: number }): Promise<TeamMessage | null> {
    const maxWaitMs = opts?.timeoutMs ?? 25_000;
    const currentUnixTime = Date.now();
    const raw = await callTool("coral_wait_for_message", { currentUnixTime, maxWaitMs });
    const parsed = parseToolResult(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as TeamMessage;
  },

  async createThread(name: string, participants: string[]): Promise<TeamThread> {
    const raw = await callTool("coral_create_thread", {
      threadName: name,
      participantNames: participants,
    });
    const parsed = parseToolResult(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`team.createThread: unexpected response ${JSON.stringify(parsed)}`);
    }
    return parsed as TeamThread;
  },
};

// Note (verified live in plan Task 11): this Coral build does NOT expose
// coral_list_threads or coral_list_agents. Discovery is not available from the
// agent side; the operator hands agents thread name + peer names via the seed
// prompt. Available tools: coral_send_message, coral_wait_for_message,
// coral_create_thread, coral_add_participant, coral_close_thread,
// coral_remove_participant, coral_wait_for_agent, coral_wait_for_mention.
