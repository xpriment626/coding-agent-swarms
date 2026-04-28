<script lang="ts">
  import type { PageProps } from "./$types";
  import type { RunSummary } from "$lib/types";

  let { data }: PageProps = $props();

  function formatDuration(ms?: number): string {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const remSec = Math.round(sec - min * 60);
    return `${min}m ${remSec}s`;
  }

  function formatStartedAt(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return sameDay ? `today ${time}` : `${d.toLocaleDateString()} ${time}`;
  }

  function exitBadgeClass(reason?: string): string {
    if (reason === "accepted") return "ok";
    if (reason === "wallclock") return "warn";
    if (reason === "error") return "error";
    if (reason === "interrupted") return "warn";
    return "";
  }

  function runModels(run: RunSummary): string[] {
    return Array.from(new Set(run.manifest.instances.map((i) => i.model)));
  }

  function uniqueModels(run: RunSummary): string {
    return runModels(run).join(", ");
  }

  // Filter chips: union of every model used across all visible runs, sorted.
  const allModels = $derived(
    Array.from(new Set(data.runs.flatMap((r) => runModels(r)))).sort()
  );

  // null = no filter (show all). Single-select per user spec.
  let selectedModel = $state<string | null>(null);

  const visibleRuns = $derived(
    selectedModel == null
      ? data.runs
      : data.runs.filter((r) => runModels(r).includes(selectedModel as string))
  );

  function pickModel(m: string | null): void {
    selectedModel = selectedModel === m ? null : m;
  }
</script>

<div class="header-row">
  <h1>Runs</h1>
  <span class="muted">
    {visibleRuns.length}
    {#if selectedModel != null}of {data.runs.length}{:else}total{/if}
  </span>
</div>

{#if data.runs.length === 0}
  <div class="empty">
    <p class="muted">
      No runs yet. Trigger a run with
      <code>bun orchestration/run-swarm-task.ts "&lt;task&gt;"</code>
      from the project root.
    </p>
  </div>
{:else}
  {#if allModels.length > 1}
    <div class="model-filter">
      <span class="filter-label">Model</span>
      <button
        class={`chip ${selectedModel == null ? "active" : ""}`}
        onclick={() => pickModel(null)}
      >
        all
      </button>
      {#each allModels as m (m)}
        <button
          class={`chip ${selectedModel === m ? "active" : ""}`}
          onclick={() => pickModel(m)}
        >
          {m}
        </button>
      {/each}
    </div>
  {/if}

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Started</th>
          <th>Run id</th>
          <th>Agents</th>
          <th>Model</th>
          <th class="num">Msgs</th>
          <th class="num">Events</th>
          <th class="num">Duration</th>
          <th>Exit</th>
        </tr>
      </thead>
      <tbody>
        {#each visibleRuns as run (run.id)}
          <tr>
            <td>
              {#if run.active}
                <span class="badge live">live</span>
              {/if}
              <span class="muted">{formatStartedAt(run.manifest.startedAt)}</span>
            </td>
            <td>
              <a class="mono" href={`/runs/${run.id}`}>{run.id}</a>
            </td>
            <td>
              <span class="mono">{run.manifest.instances.map((i) => i.name).join(", ")}</span>
            </td>
            <td>
              <span class="muted mono">{uniqueModels(run)}</span>
            </td>
            <td class="num mono">{run.messageCount}</td>
            <td class="num mono">{run.eventCount}</td>
            <td class="num mono">{formatDuration(run.durationMs)}</td>
            <td>
              {#if run.manifest.exitReason}
                <span class={`badge ${exitBadgeClass(run.manifest.exitReason)}`}>
                  {run.manifest.exitReason}
                </span>
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .header-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 18px;
  }
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .empty {
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 32px;
    text-align: center;
  }
  .table-wrap {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-elevated);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  th {
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    color: var(--fg-muted);
    background: var(--bg-elevated-2);
  }
  td.num,
  th.num {
    text-align: right;
  }
  tbody tr:hover {
    background: var(--bg-elevated-2);
  }

  /* ---- model filter ---- */
  .model-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 0 0 14px 0;
  }
  .filter-label {
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    color: var(--fg-muted);
    margin-right: 4px;
  }
  .chip {
    background: transparent;
    color: var(--fg-muted);
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11.5px;
    font-family: var(--mono);
    cursor: pointer;
  }
  .chip:hover {
    background: var(--bg-elevated-2);
    color: var(--fg);
  }
  .chip.active {
    background: var(--bg-elevated-2);
    color: var(--accent);
    border-color: var(--accent-dim);
  }
</style>
