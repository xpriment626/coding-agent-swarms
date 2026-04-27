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
let lastSeenTs = 0;

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

  async wait(opts?: {
    thread?: string;
    mentions?: string[];
    timeoutMs?: number;
  }): Promise<TeamMessage[]> {
    const timeoutMs = opts?.timeoutMs ?? 25_000;
    const replayAfter = lastSeenTs > 0 ? lastSeenTs - 1 : 0;
    const args: Record<string, unknown> = {
      timeoutMs,
      replayAfter,
    };
    if (opts?.thread) args.threadId = opts.thread;
    if (opts?.mentions?.length) args.mentions = opts.mentions;

    const raw = await callTool("coral_wait_for_message", args);
    const parsed = parseToolResult(raw);
    const messages: TeamMessage[] = Array.isArray(parsed) ? (parsed as TeamMessage[]) : [];
    for (const m of messages) {
      const ts = new Date(m.timestamp).getTime();
      if (ts > lastSeenTs) lastSeenTs = ts;
    }
    return messages;
  },

  async threads(): Promise<TeamThread[]> {
    const raw = await callTool("coral_list_threads", {});
    const parsed = parseToolResult(raw);
    return Array.isArray(parsed) ? (parsed as TeamThread[]) : [];
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

  async agents(): Promise<TeamAgent[]> {
    const raw = await callTool("coral_list_agents", {});
    const parsed = parseToolResult(raw);
    return Array.isArray(parsed) ? (parsed as TeamAgent[]) : [];
  },
};
