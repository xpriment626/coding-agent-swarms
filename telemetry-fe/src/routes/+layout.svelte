<script lang="ts">
  import "../app.css";
  let { children } = $props();
</script>

<svelte:head>
  <title>team-swarm telemetry</title>
</svelte:head>

<header>
  <a href="/" class="brand">team-swarm telemetry</a>
  <span class="muted dim mono">research desk · v1</span>
</header>

<main>
  {@render children()}
</main>

<style>
  header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
  }
  .brand {
    font-weight: 600;
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .brand:hover {
    text-decoration: none;
    color: var(--accent);
  }
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px;
  }
</style>
