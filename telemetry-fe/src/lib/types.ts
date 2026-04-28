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

// Per-step shape inside an AgentTraceIter, as emitted by AI SDK v4 generateText
// `result.steps`. Fields are permissive: provider/model determines which are
// populated. `request`/`response`/`files`/`sources`/`warnings` are intentionally
// omitted from this type (huge payloads, low signal for v1).
export type AgentStep = {
  stepType?: string;
  text?: string;
  reasoning?: string;
  // Provider-shaped reasoning segments (Kimi K2.6 emits [{type:"text", text:"..."}]).
  // Rendered as JSON.stringify in v1.
  reasoningDetails?: unknown;
  toolCalls?: Array<{
    toolCallId?: string;
    toolName?: string;
    args?: { code?: string } & Record<string, unknown>;
  }>;
  toolResults?: Array<{
    toolCallId?: string;
    toolName?: string;
    result?: unknown;
  }>;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  isContinued?: boolean;
};

// One JSONL line in runs/<id>/agents/<name>.jsonl — one outer-loop iteration
// of the agent runtime. See team-swarm/shared/run-agent.ts writeTrace().
export type AgentTraceIter = {
  ts: string;
  agent: string;
  iter: number;
  model: string;
  durationMs: number;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  text?: string;
  steps: AgentStep[];
};

export type AgentTrace = {
  agent: string;
  iters: AgentTraceIter[];
};

export type RunDetail = {
  id: string;
  manifest: Manifest;
  transcript: TranscriptMessage[];
  events: SessionEvent[];
  agentTraces: AgentTrace[];
  // Optional final session snapshot if available.
  finalSnapshot: unknown | null;
};
