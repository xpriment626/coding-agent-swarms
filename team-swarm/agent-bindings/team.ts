// team binding — peer comms via Coral MCP. Loaded inside the run_typescript subprocess.
//
// Uses CORAL_CONNECTION_URL injected by Coral (Streamable HTTP MCP endpoint).
// Self-mentions are filtered before send (server silently drops them).
//
// wait() uses `coral_wait_for_mention` (not `coral_wait_for_message`) because
// Coral has no per-agent delivered/undelivered ledger — its replayAfter floor
// (`currentUnixTime`) is pure timestamp filtering. The mention variant
// auto-filters to messages mentioning this agent, which is what the puppet
// kickoff uses and what every peer post should use to address us. We persist
// a per-session-per-agent watermark to a file so new subprocesses can advance
// past already-seen messages without re-receiving them.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type TeamMessage = {
  id: string;
  senderName: string;
  text: string;
  timestamp: string;
  threadId: string;
  mentionNames: string[];
};

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

function watermarkPath(): string {
  const sid = process.env.CORAL_SESSION_ID ?? "no-session";
  return join(tmpdir(), `team-swarm-watermark-${agentName()}-${sid}`);
}

function readWatermark(): number {
  try {
    if (!existsSync(watermarkPath())) return 0;
    const v = parseInt(readFileSync(watermarkPath(), "utf8").trim(), 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function writeWatermark(ts: number): void {
  try {
    writeFileSync(watermarkPath(), String(ts));
  } catch {
    // best effort
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

  // Blocks until the next mention of this agent arrives, OR until maxWaitMs
  // elapses. Returns the message or null on timeout. Coral caps maxWaitMs
  // server-side at 60s; passing more is silently clamped.
  //
  // Wire format (verified live + Coral source):
  //   on hit: { message: TeamMessage, status: "Message received" }
  //   on timeout: { status: "Timeout reached" } (no `.message` field)
  //
  // Watermark is persisted across subprocesses via a per-session file so we
  // (a) replay the operator's kick-off message on the very first wait even
  // if it was posted before this agent connected, and (b) advance past the
  // last-seen message so we don't keep re-receiving the same one.
  async wait(opts?: { timeoutMs?: number }): Promise<TeamMessage | null> {
    const maxWaitMs = Math.min(opts?.timeoutMs ?? 25_000, 60_000);
    const currentUnixTime = readWatermark(); // 0 on first call → server replays from epoch
    const raw = await callTool("coral_wait_for_mention", { currentUnixTime, maxWaitMs });
    const parsed = parseToolResult(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const envelope = parsed as { message?: TeamMessage; status?: string };
    if (!envelope.message) return null; // timeout

    const msg = envelope.message;
    if (msg.timestamp) {
      const ts = new Date(msg.timestamp).getTime();
      if (Number.isFinite(ts) && ts >= currentUnixTime) writeWatermark(ts + 1);
    }
    return msg;
  },
};

// Thread discipline is enforced structurally: this binding deliberately exposes
// only post() and wait(). The MCP tool `coral_create_thread` exists on this
// build but is NOT bound — the operator pre-creates the team-room thread and
// agents learn its threadId from the kick-off message. If an agent calls
// `team.createThread(...)` it now throws TypeError, surfacing the violation in
// stderr instead of fragmenting the conversation across operator-invisible
// threads.
//
// Available MCP tools on this Coral build (verified live, plan Task 11):
// coral_send_message, coral_wait_for_message, coral_create_thread,
// coral_add_participant, coral_close_thread, coral_remove_participant,
// coral_wait_for_agent, coral_wait_for_mention. coral_list_threads and
// coral_list_agents are NOT exposed.
