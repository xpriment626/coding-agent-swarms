<script lang="ts">
  import type { PageProps } from "./$types";
  import type { SessionEvent } from "$lib/types";

  let { data }: PageProps = $props();
  const run = $derived(data.run);

  // ---- transcript helpers ----

  // Map sender name to a consistent color from a small palette.
  const palette = [
    "#6ee7b7", // mint  (accent)
    "#fbbf24", // amber
    "#60a5fa", // blue
    "#f472b6", // pink
    "#a78bfa", // violet
    "#fb923c", // orange
  ];
  function senderColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length] ?? palette[0]!;
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function shortThread(threadId: string): string {
    return threadId.length > 8 ? threadId.slice(0, 8) : threadId;
  }

  // ---- event timeline filtering ----
  // Track EXCLUDED types instead of included — empty set = show all (default).
  // Avoids needing to seed state from a derived value on first load.

  const eventTypes = $derived(Array.from(new Set(run.events.map((e) => e.type))).sort());
  let excluded = $state<Set<string>>(new Set());

  const filteredEvents = $derived(run.events.filter((e) => !excluded.has(e.type)));

  function toggleFilter(t: string): void {
    const next = new Set(excluded);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    excluded = next;
  }
  function showAll(): void {
    excluded = new Set();
  }
  function showNone(): void {
    excluded = new Set(eventTypes);
  }

  function eventOneLine(e: SessionEvent): string {
    if (e.type === "thread_message_sent" && e.message) {
      const m = e.message;
      const text = m.text.length > 120 ? m.text.slice(0, 120) + "…" : m.text;
      return `${m.senderName} → ${shortThread(m.threadId)}: ${text}`;
    }
    if (e.type === "thread_created" && e.thread) {
      return `thread ${shortThread(e.thread.id)} (participants: ${e.thread.participants.join(", ")})`;
    }
    if (e.name) return e.name;
    return "";
  }

  // ---- timing ----

  function startedToEnded(): string {
    const start = run.manifest.startedAt;
    const end = run.manifest.endedAt;
    if (!end) return `started ${formatTime(start)}`;
    return `${formatTime(start)} → ${formatTime(end)}`;
  }

  function durationStr(): string {
    if (!run.manifest.endedAt) return "ongoing";
    const ms =
      new Date(run.manifest.endedAt).getTime() - new Date(run.manifest.startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const remSec = Math.round(sec - min * 60);
    return `${min}m ${remSec}s`;
  }

  function exitBadgeClass(reason?: string): string {
    if (reason === "accepted") return "ok";
    if (reason === "wallclock") return "warn";
    if (reason === "error") return "error";
    if (reason === "interrupted") return "warn";
    return "";
  }
</script>

<svelte:head>
  <title>{run.id} · team-swarm telemetry</title>
</svelte:head>

<div class="back-row">
  <a href="/" class="back">← all runs</a>
</div>

<header class="run-header">
  <div>
    <h1 class="mono">{run.id}</h1>
    <div class="muted run-sub">
      {startedToEnded()} · {durationStr()}
      {#if run.manifest.exitReason}
        · <span class={`badge ${exitBadgeClass(run.manifest.exitReason)}`}>{run.manifest.exitReason}</span>
      {/if}
    </div>
  </div>
</header>

<div class="layout">
  <section class="transcript">
    <h2>Transcript <span class="muted dim">({run.transcript.length})</span></h2>
    {#if run.transcript.length === 0}
      <p class="muted dim">No messages were captured for this run.</p>
    {:else}
      <ol class="messages">
        {#each run.transcript as m (m.messageId)}
          <li>
            <div class="msg-meta">
              <span class="sender" style:color={senderColor(m.sender)}>{m.sender}</span>
              <span class="dim mono">→ {shortThread(m.thread)}</span>
              {#if m.mentions && m.mentions.length > 0}
                <span class="dim">@ {m.mentions.join(", ")}</span>
              {/if}
              <span class="dim mono right">{formatTime(m.at)}</span>
            </div>
            <div class="msg-body">{m.text}</div>
          </li>
        {/each}
      </ol>
    {/if}

    <details class="events-block">
      <summary>
        <span>Event timeline</span>
        <span class="muted dim">({filteredEvents.length} / {run.events.length})</span>
      </summary>

      <div class="filters">
        <button class="chip-action" onclick={showAll}>all</button>
        <button class="chip-action" onclick={showNone}>none</button>
        {#each eventTypes as t (t)}
          <button
            class={`chip ${!excluded.has(t) ? "active" : ""}`}
            onclick={() => toggleFilter(t)}
          >
            {t}
          </button>
        {/each}
      </div>

      <ol class="events">
        {#each filteredEvents as e, i (i)}
          <li>
            <span class="dim mono">{e.timestamp ? formatTime(e.timestamp) : "—"}</span>
            <span class="ev-type">{e.type}</span>
            {#if e.name}<span class="muted">({e.name})</span>{/if}
            <span class="dim ev-detail">{eventOneLine(e)}</span>
          </li>
        {/each}
      </ol>
    </details>
  </section>

  <aside class="sidebar">
    <section>
      <h3>Manifest</h3>
      <dl>
        <dt>Session</dt>
        <dd class="mono">{run.manifest.sessionId}</dd>
        <dt>Sandbox</dt>
        <dd class="mono">{run.manifest.sandboxId}</dd>
        <dt>Namespace</dt>
        <dd class="mono">{run.manifest.namespace}</dd>
      </dl>
    </section>

    <section>
      <h3>Agents</h3>
      <ul class="agents">
        {#each run.manifest.instances as inst (inst.name)}
          <li>
            <span class="sender" style:color={senderColor(inst.name)}>{inst.name}</span>
            <span class="muted mono">{inst.model}</span>
          </li>
        {/each}
      </ul>
    </section>

    {#if run.manifest.acceptanceResult !== undefined}
      <section>
        <h3>Acceptance</h3>
        <p>
          <span class={`badge ${run.manifest.acceptanceResult.passed ? "ok" : "error"}`}>
            {run.manifest.acceptanceResult.passed ? "passed" : "failed"}
          </span>
        </p>
      </section>
    {/if}

    {#if run.manifest.errors && run.manifest.errors.length > 0}
      <section>
        <h3>Errors <span class="muted dim">({run.manifest.errors.length})</span></h3>
        <ul class="errors">
          {#each run.manifest.errors as err, i (i)}
            <li><pre>{err}</pre></li>
          {/each}
        </ul>
      </section>
    {/if}
  </aside>
</div>

<style>
  .back-row {
    margin-bottom: 12px;
  }
  .back {
    font-size: 12.5px;
    color: var(--fg-muted);
  }
  .back:hover {
    color: var(--accent);
  }
  .run-header {
    margin-bottom: 24px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }
  .run-header h1 {
    font-size: 18px;
    margin: 0 0 4px 0;
    color: var(--fg);
    font-weight: 600;
    letter-spacing: 0;
  }
  .run-sub {
    font-size: 12.5px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 32px;
    align-items: start;
  }
  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  h2 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    margin: 0 0 14px 0;
  }
  h3 {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    margin: 0 0 10px 0;
  }

  .messages {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .messages li {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
  }
  .msg-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 6px;
  }
  .msg-meta .right {
    margin-left: auto;
  }
  .sender {
    font-weight: 600;
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .msg-body {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13.5px;
    color: var(--fg);
  }

  .events-block {
    margin-top: 28px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    padding: 12px 14px;
  }
  .events-block summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-weight: 600;
    color: var(--fg-muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .events-block summary::-webkit-details-marker {
    display: none;
  }
  .events-block summary::before {
    content: "▸";
    font-size: 10px;
    color: var(--fg-dim);
    transition: transform 0.15s ease;
    display: inline-block;
  }
  .events-block[open] summary::before {
    transform: rotate(90deg);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0 12px 0;
  }
  .chip,
  .chip-action {
    background: transparent;
    color: var(--fg-muted);
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11.5px;
    font-family: var(--mono);
  }
  .chip:hover,
  .chip-action:hover {
    background: var(--bg-elevated-2);
    color: var(--fg);
  }
  .chip.active {
    background: var(--bg-elevated-2);
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .events {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 480px;
    overflow: auto;
  }
  .events li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 12px;
    padding: 3px 0;
    border-bottom: 1px solid transparent;
  }
  .ev-type {
    font-family: var(--mono);
    color: var(--fg);
    font-size: 11.5px;
  }
  .ev-detail {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 22px;
    position: sticky;
    top: 24px;
  }
  .sidebar section {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    font-size: 12px;
  }
  dt {
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
    align-self: center;
  }
  dd {
    margin: 0;
    word-break: break-all;
    color: var(--fg);
  }
  .agents {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
  }
  .agents li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .errors {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .errors pre {
    font-size: 11.5px;
    color: var(--error);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
</style>
