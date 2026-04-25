/**
 * Daytona Toolbox HTTP client.
 *
 * Auth note (verified 2026-04-25 via direct probe): every Toolbox endpoint
 * — /process/execute, /files, /files/download, /files/upload — accepts the
 * standard `Authorization: Bearer <key>` header. The previously-documented
 * `X-Daytona-Authorization` variant now returns 401 on every endpoint we
 * tested. If a future Daytona release flips this back, surface the 401 in
 * the thrown Error message so it's obvious from a single agent log.
 *
 * Workspace note: Daytona sandboxes ship with `/home/daytona` but NOT
 * `/workspace`. The orchestrator's create-sandbox.sh creates and chowns
 * /workspace right after the sandbox starts so all `daytona_*` tool calls
 * pointing there land somewhere real.
 *
 * Throws on any non-2xx so `daytona_write_file` reports real failures
 * instead of silently swallowing them like the previous Kotlin/ktor port.
 */

const DEFAULT_PROXY = 'https://proxy.app.daytona.io';

/**
 * The Daytona toolbox `/process/execute` endpoint returns a single combined
 * output stream as `result`, not separate stdout/stderr. We surface it as
 * `result` and keep `exitCode` for the LLM to read in tool results.
 */
export interface ExecResult {
  exitCode: number;
  result: string;
}

export class DaytonaToolbox {
  readonly sandboxId: string;
  private readonly apiKey: string;
  private readonly proxyBaseUrl: string;

  constructor(opts: { sandboxId: string; apiKey: string; proxyBaseUrl?: string }) {
    this.sandboxId = opts.sandboxId;
    this.apiKey = opts.apiKey;
    this.proxyBaseUrl = opts.proxyBaseUrl ?? DEFAULT_PROXY;
  }

  private get base(): string {
    return `${this.proxyBaseUrl}/toolbox/${this.sandboxId}`;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    const res = await fetch(`${this.base}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Daytona ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`,
      );
    }
    return res;
  }

  async readFile(path: string): Promise<string> {
    const url = `/files/download?path=${encodeURIComponent(path)}`;
    const res = await this.request(url, { method: 'GET' });
    return res.text();
  }

  async writeFile(path: string, content: string): Promise<{ bytesWritten: number }> {
    const url = `/files/upload?path=${encodeURIComponent(path)}`;
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain' }), basename(path));
    await this.request(url, { method: 'POST', body: form });
    return { bytesWritten: byteLength(content) };
  }

  async listFiles(path: string = '/workspace'): Promise<string> {
    const url = `/files?path=${encodeURIComponent(path)}`;
    const res = await this.request(url, { method: 'GET', redirect: 'follow' });
    return res.text();
  }

  async exec(command: string, cwd: string = '/workspace', timeoutSec: number = 60): Promise<ExecResult> {
    const res = await this.request('/process/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, cwd, timeout: timeoutSec }),
    });
    const data = (await res.json()) as Partial<ExecResult> & { stdout?: string; stderr?: string };
    return {
      exitCode: data.exitCode ?? 0,
      // Daytona switched to a single `result` field; fall back to legacy stdout/stderr in case it flips back.
      result: data.result ?? [data.stdout, data.stderr].filter(Boolean).join('\n') ?? '',
    };
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}
