import type { ExecResult, SessionEvent, SessionSnapshot, SessionSpec } from "./types.ts";

const env = {
  daytonaApiKey: process.env.DAYTONA_API_KEY ?? "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  exaApiKey: process.env.EXA_API_KEY ?? "",
  coralAuthKey: process.env.CORAL_AUTH_KEY ?? "dev",
  coralHttpBase: process.env.CORAL_HTTP_BASE ?? "http://localhost:5555",
  coralWsBase: process.env.CORAL_WS_BASE ?? "ws://localhost:5555",
};

function requireEnv(name: keyof typeof env): string {
  const v = env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const DAYTONA_API_BASE = "https://app.daytona.io/api";
const DAYTONA_TOOLBOX_BASE = "https://proxy.app.daytona.io/toolbox";

async function daytonaHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${requireEnv("daytonaApiKey")}`,
    "Content-Type": "application/json",
  };
}

async function throwOnNon2xx(res: Response, ctx: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "<no body>");
  throw new Error(`${ctx}: HTTP ${res.status} — ${body}`);
}

export async function createSandbox(): Promise<{ sandboxId: string }> {
  const res = await fetch(`${DAYTONA_API_BASE}/sandbox`, {
    method: "POST",
    headers: await daytonaHeaders(),
    body: "{}",
  });
  await throwOnNon2xx(res, "createSandbox");
  const data = (await res.json()) as { id: string };
  if (!data.id) throw new Error(`createSandbox: response missing id: ${JSON.stringify(data)}`);
  return { sandboxId: data.id };
}

export async function destroySandbox(sandboxId: string): Promise<void> {
  const res = await fetch(`${DAYTONA_API_BASE}/sandbox/${encodeURIComponent(sandboxId)}?force=true`, {
    method: "DELETE",
    headers: await daytonaHeaders(),
  });
  if (res.status === 404) return;
  await throwOnNon2xx(res, "destroySandbox");
}

export async function verifySandboxGone(
  sandboxId: string,
  opts?: { attempts?: number; delayMs?: number }
): Promise<boolean> {
  // Daytona DELETE→GET-404 propagation has up to ~10s lag in observation.
  // Poll until 404 or give up.
  const attempts = opts?.attempts ?? 8;
  const delayMs = opts?.delayMs ?? 1500;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${DAYTONA_API_BASE}/sandbox/${encodeURIComponent(sandboxId)}`, {
      method: "GET",
      headers: await daytonaHeaders(),
    });
    if (res.status === 404) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

export async function exec(
  sandboxId: string,
  command: string,
  opts?: { cwd?: string; timeout?: number }
): Promise<ExecResult> {
  const body: Record<string, unknown> = { command, timeout: opts?.timeout ?? 30 };
  if (opts?.cwd) body.cwd = opts.cwd;
  const res = await fetch(
    `${DAYTONA_TOOLBOX_BASE}/${encodeURIComponent(sandboxId)}/process/execute`,
    {
      method: "POST",
      headers: await daytonaHeaders(),
      body: JSON.stringify(body),
    }
  );
  await throwOnNon2xx(res, "exec");
  const data = (await res.json()) as {
    exitCode?: number;
    result?: string;
    stdout?: string;
    stderr?: string;
  };
  // Daytona current shape: {exitCode, result}. Legacy fallback: {exitCode, stdout, stderr}.
  return {
    stdout: data.result ?? data.stdout ?? "",
    stderr: data.stderr ?? "",
    exitCode: data.exitCode ?? 0,
  };
}

export async function prewarmWorkspace(sandboxId: string): Promise<void> {
  const r = await exec(
    sandboxId,
    "sudo mkdir -p /workspace && sudo chown daytona:daytona /workspace && ls -ld /workspace",
    { timeout: 15 }
  );
  if (r.exitCode !== 0) {
    throw new Error(`prewarmWorkspace: exitCode ${r.exitCode}, stdout=${r.stdout}, stderr=${r.stderr}`);
  }
}

async function coralHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${requireEnv("coralAuthKey")}`,
    "Content-Type": "application/json",
  };
}

export async function createSession(
  spec: SessionSpec
): Promise<{ namespace: string; sessionId: string }> {
  const res = await fetch(`${env.coralHttpBase}/api/v1/local/session`, {
    method: "POST",
    headers: await coralHeaders(),
    body: JSON.stringify(spec),
  });
  await throwOnNon2xx(res, "createSession");
  const data = (await res.json()) as { namespace?: string; sessionId?: string };
  if (!data.namespace || !data.sessionId) {
    throw new Error(`createSession: response missing fields: ${JSON.stringify(data)}`);
  }
  return { namespace: data.namespace, sessionId: data.sessionId };
}

export async function getSessionSnapshot(ns: string, sid: string): Promise<SessionSnapshot> {
  const res = await fetch(
    `${env.coralHttpBase}/api/v1/local/session/${encodeURIComponent(ns)}/${encodeURIComponent(sid)}/extended`,
    { method: "GET", headers: await coralHeaders() }
  );
  await throwOnNon2xx(res, "getSessionSnapshot");
  return (await res.json()) as SessionSnapshot;
}

export function subscribeSessionEvents(
  ns: string,
  sid: string,
  onEvent: (e: SessionEvent) => void
): { close: () => void } {
  const token = requireEnv("coralAuthKey");
  const url = `${env.coralWsBase}/ws/v1/events/${encodeURIComponent(token)}/session/${encodeURIComponent(ns)}/${encodeURIComponent(sid)}`;

  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onmessage = (ev: MessageEvent) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      if (!data) return;
      try {
        const parsed = JSON.parse(data) as SessionEvent;
        onEvent(parsed);
      } catch {
        // Ignore unparseable frames
      }
    };
    ws.onclose = () => {
      if (closed) return;
      reconnectTimer = setTimeout(connect, 2500);
    };
    ws.onerror = () => {
      // onclose follows; let the reconnect path handle it.
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    },
  };
}

export async function puppetCreateThread(
  ns: string,
  sid: string,
  threadName: string,
  participantNames: string[]
): Promise<{ threadId: string }> {
  const res = await fetch(
    `${env.coralHttpBase}/api/v1/puppet/${encodeURIComponent(ns)}/${encodeURIComponent(sid)}/puppet/thread`,
    {
      method: "POST",
      headers: await coralHeaders(),
      body: JSON.stringify({ threadName, participantNames }),
    }
  );
  await throwOnNon2xx(res, "puppetCreateThread");
  const data = (await res.json()) as { thread?: { id?: string } };
  if (!data.thread?.id) {
    throw new Error(`puppetCreateThread: response missing thread.id: ${JSON.stringify(data)}`);
  }
  return { threadId: data.thread.id };
}

export async function puppetForceEndRuntime(ns: string, sid: string): Promise<void> {
  const res = await fetch(
    `${env.coralHttpBase}/api/v1/puppet/${encodeURIComponent(ns)}/${encodeURIComponent(sid)}/puppet/runtime/end`,
    { method: "POST", headers: await coralHeaders() }
  );
  // 404 is acceptable per foundation memory — endpoint may have moved.
  if (res.status === 404) return;
  await throwOnNon2xx(res, "puppetForceEndRuntime");
}

// Re-export types so consumers can import everything from one place.
export type { ExecResult, SessionEvent, SessionSnapshot, SessionSpec };
