// Server-only disk reader for runs/<id>/. Resolves RUNS_DIR (env var) or
// defaults to ../runs relative to telemetry-fe/. Parses JSONL line-by-line,
// tolerating partial last lines (writer may be mid-flush in a future live-tail
// world — for v1 we just guard against empty/truncated lines).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  AgentTrace,
  AgentTraceIter,
  Manifest,
  RunDetail,
  RunSummary,
  SessionEvent,
  TranscriptMessage,
} from "./types.ts";

const DEFAULT_RUNS_DIR = "../runs";

function runsDir(): string {
  return resolve(process.cwd(), process.env.RUNS_DIR ?? DEFAULT_RUNS_DIR);
}

function readJsonlLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed lines silently — likely a partial flush.
    }
  }
  return out;
}

function readManifest(runDirPath: string): Manifest | null {
  const path = join(runDirPath, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

function isActive(runDirPath: string, manifest: Manifest): boolean {
  if (manifest.endedAt) return false;
  // Fallback heuristic for malformed manifests: directory mtime within 5 minutes.
  try {
    const st = statSync(runDirPath);
    return Date.now() - st.mtimeMs < 5 * 60 * 1000;
  } catch {
    return false;
  }
}

function durationFromManifest(m: Manifest): number | undefined {
  if (!m.endedAt) return undefined;
  try {
    return new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime();
  } catch {
    return undefined;
  }
}

export function listRuns(): RunSummary[] {
  const root = runsDir();
  if (!existsSync(root)) return [];

  const entries = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const summaries: RunSummary[] = [];

  for (const id of entries) {
    const runDirPath = join(root, id);
    const manifest = readManifest(runDirPath);
    if (!manifest) continue;
    const transcript = readJsonlLines<TranscriptMessage>(
      join(runDirPath, "transcript.jsonl")
    );
    const events = readJsonlLines<SessionEvent>(join(runDirPath, "events.jsonl"));
    summaries.push({
      id,
      manifest,
      durationMs: durationFromManifest(manifest),
      messageCount: transcript.length,
      eventCount: events.length,
      active: isActive(runDirPath, manifest),
    });
  }

  // Newest first — directory names start with timestamp prefix yyyymmdd-hhmmss
  // so plain string descending sort is correct.
  summaries.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return summaries;
}

function readAgentTraces(runDirPath: string): AgentTrace[] {
  const agentsDir = join(runDirPath, "agents");
  if (!existsSync(agentsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(agentsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const traces: AgentTrace[] = [];
  for (const file of entries) {
    const agent = file.replace(/\.jsonl$/, "");
    const iters = readJsonlLines<AgentTraceIter>(join(agentsDir, file));
    iters.sort((a, b) => a.iter - b.iter);
    traces.push({ agent, iters });
  }
  // Stable order by agent name so the UI is deterministic across reloads.
  traces.sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));
  return traces;
}

export function getRun(id: string): RunDetail | null {
  // Defensive: reject ids with path separators to prevent traversal.
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return null;

  const runDirPath = join(runsDir(), id);
  if (!existsSync(runDirPath)) return null;

  const manifest = readManifest(runDirPath);
  if (!manifest) return null;

  const transcript = readJsonlLines<TranscriptMessage>(
    join(runDirPath, "transcript.jsonl")
  );
  const events = readJsonlLines<SessionEvent>(join(runDirPath, "events.jsonl"));
  const agentTraces = readAgentTraces(runDirPath);

  let finalSnapshot: unknown | null = null;
  const snapPath = join(runDirPath, "final-snapshot.json");
  if (existsSync(snapPath)) {
    try {
      finalSnapshot = JSON.parse(readFileSync(snapPath, "utf8"));
    } catch {
      finalSnapshot = null;
    }
  }

  return { id, manifest, transcript, events, agentTraces, finalSnapshot };
}
