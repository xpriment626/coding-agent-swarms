// daytona binding — workspace I/O via HTTP to Daytona toolbox proxy.
// Loaded inside the run_typescript subprocess.

const TOOLBOX_BASE = "https://proxy.app.daytona.io/toolbox";

function sandboxId(): string {
  const id = process.env.DAYTONA_SANDBOX_ID;
  if (!id) throw new Error("DAYTONA_SANDBOX_ID not set");
  return id;
}

function authHeaders(): Record<string, string> {
  const key = process.env.DAYTONA_API_KEY;
  if (!key) throw new Error("DAYTONA_API_KEY not set");
  return { Authorization: `Bearer ${key}` };
}

async function throwIfBad(res: Response, ctx: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "<no body>");
  throw new Error(`${ctx}: HTTP ${res.status} — ${body}`);
}

export const daytona = {
  async read(path: string): Promise<string> {
    const res = await fetch(
      `${TOOLBOX_BASE}/${encodeURIComponent(sandboxId())}/files/download?path=${encodeURIComponent(path)}`,
      { method: "GET", headers: authHeaders() }
    );
    await throwIfBad(res, `daytona.read(${path})`);
    return await res.text();
  },

  async write(path: string, content: string): Promise<void> {
    const form = new FormData();
    form.set(
      "file",
      new Blob([content], { type: "application/octet-stream" }),
      path.split("/").pop() ?? "file"
    );
    const res = await fetch(
      `${TOOLBOX_BASE}/${encodeURIComponent(sandboxId())}/files/upload?path=${encodeURIComponent(path)}`,
      { method: "POST", headers: authHeaders(), body: form }
    );
    await throwIfBad(res, `daytona.write(${path})`);
  },

  async exec(
    command: string,
    opts?: { cwd?: string; timeout?: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const body: Record<string, unknown> = { command, timeout: opts?.timeout ?? 30 };
    if (opts?.cwd) body.cwd = opts.cwd;
    const res = await fetch(
      `${TOOLBOX_BASE}/${encodeURIComponent(sandboxId())}/process/execute`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    await throwIfBad(res, "daytona.exec");
    const data = (await res.json()) as {
      exitCode?: number;
      result?: string;
      stdout?: string;
      stderr?: string;
    };
    return {
      stdout: data.result ?? data.stdout ?? "",
      stderr: data.stderr ?? "",
      exitCode: data.exitCode ?? 0,
    };
  },

  async list(path: string): Promise<string[]> {
    const res = await fetch(
      `${TOOLBOX_BASE}/${encodeURIComponent(sandboxId())}/files?path=${encodeURIComponent(path)}`,
      { method: "GET", headers: authHeaders(), redirect: "follow" }
    );
    await throwIfBad(res, `daytona.list(${path})`);
    const data = (await res.json()) as
      | Array<{ name?: string }>
      | { entries?: Array<{ name?: string }> };
    const arr = Array.isArray(data) ? data : (data.entries ?? []);
    return arr.map((e) => e.name ?? "").filter(Boolean);
  },
};
