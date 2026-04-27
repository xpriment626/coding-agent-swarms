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

export type SessionSnapshot = {
  agents: Array<{
    name?: string;
    id?: string;
    base?: { id?: string; name?: string };
    status?: { type?: string };
  }>;
  threads: Array<{
    id: string;
    participants: string[];
    messages: Array<{
      id: string;
      senderName: string;
      text: string;
      timestamp: string;
      threadId: string;
      mentionNames: string[];
    }>;
  }>;
};

export type ExecResult = { stdout: string; stderr: string; exitCode: number };

export type AgentInstanceSpec = { name: string };

export type SessionAgentSpec = {
  id: { name: string; version: string; registrySourceId: { type: "local" } };
  name: string;
  description: string;
  provider: { type: "local"; runtime: "executable" | "prototype" };
  blocking: false;
  customToolAccess: [];
  plugins: [];
  x402Budgets: [];
  options: Record<string, { type: "string"; value: string }>;
};

export type SessionSpec = {
  agentGraphRequest: {
    agents: SessionAgentSpec[];
    groups: [];
    customTools: Record<string, never>;
  };
  namespaceProvider: {
    type: "create_if_not_exists";
    namespaceRequest: {
      name: "default";
      annotations: Record<string, never>;
      deleteOnLastSessionExit: false;
    };
  };
  execution: {
    mode: "immediate";
    runtimeSettings: { extendedEndReport: false; ttl: number };
  };
};

export type TaskResult = {
  exitReason: "accepted" | "wallclock" | "error" | "interrupted";
  acceptanceResult?: { passed: boolean };
  durationMs: number;
  runDir: string;
  errors: string[];
};
