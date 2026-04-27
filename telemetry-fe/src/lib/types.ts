// Shared types for the telemetry frontend. Mirror the JSONL/JSON shape produced
// by orchestration/run-swarm-task.ts so a server load function can hand off
// to a Svelte component without further parsing.

export type Manifest = {
  namespace: string;
  sessionId: string;
  sandboxId: string;
  instances: Array<{ name: string; model: string }>;
  startedAt: string;
  endedAt?: string;
  exitReason?: "accepted" | "wallclock" | "error" | "interrupted";
  acceptanceResult?: { passed: boolean };
  errors?: string[];
};

export type TranscriptMessage = {
  at: string;
  sender: string;
  thread: string;
  text: string;
  mentions: string[];
  messageId: string;
};

export type SessionEvent = {
  type: string;
  timestamp?: string;
  name?: string;
  threadId?: string;
  thread?: { id: string; participants: string[] };
  message?: {
    id: string;
    senderName: string;
    text: string;
    timestamp: string;
    threadId: string;
    mentionNames: string[];
  };
  [key: string]: unknown;
};

export type RunSummary = {
  id: string;
  manifest: Manifest;
  durationMs?: number;
  messageCount: number;
  eventCount: number;
  // True if manifest.endedAt is missing AND the runDir's last-modified time is recent.
  active: boolean;
};

export type RunDetail = {
  id: string;
  manifest: Manifest;
  transcript: TranscriptMessage[];
  events: SessionEvent[];
  // Optional final session snapshot if available.
  finalSnapshot: unknown | null;
};
