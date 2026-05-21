<script lang="ts">
  import { onMount } from "svelte";
  import { findPage, pages, type NativePage } from "./appCatalog";
  import type { Component } from "svelte";

  let selected = $state<NativePage | null>(null);
  let ActivePage = $state<Component | null>(null);
  let loading = $state(false);
  let menuOpen = $state(false);

  const isHome = $derived(!selected);

  async function loadRoute(pathname: string) {
    const page = findPage(pathname);
    selected = page;
    ActivePage = null;

    if (!page) {
      loading = false;
      return;
    }

    loading = true;
    const module = await page.load();
    if (selected?.id === page.id) {
      ActivePage = module.default;
      loading = false;
    }
  }

  function navigate(path: string) {
    window.location.assign(path);
  }

  onMount(() => {
    void loadRoute(window.location.pathname);
  });
</script>

<svelte:head>
  <title>{selected?.title ?? "Sibambo Native Svelte Pages"}</title>
</svelte:head>

{#if isHome}
  <main class="home-shell">
    <section class="home-header">
      <div class="home-mark">SB</div>
      <div>
        <p>Sibambo BOM Engine</p>
        <h1>Native Svelte Pages</h1>
      </div>
    </section>

    <nav class="home-grid" aria-label="Native Svelte pages">
      {#each pages as page}
        <button type="button" onclick={() => navigate(page.path)}>
          <span>{page.title}</span>
          <small>{page.description}</small>
        </button>
      {/each}
    </nav>
  </main>
{:else}
  <button
    class="floating-menu-button"
    class:open={menuOpen}
    type="button"
    aria-label={menuOpen ? "Hide page navigation" : "Show page navigation"}
    aria-expanded={menuOpen}
    onclick={() => (menuOpen = !menuOpen)}
  >
    {menuOpen ? "×" : "☰"}
  </button>

  {#if menuOpen}
    <div class="floating-menu" role="dialog" aria-label="Page navigation">
      <button class="home-link" type="button" onclick={() => navigate("/")}>Index</button>
      {#each pages as page}
        <button
          class:active={selected?.id === page.id}
          type="button"
          onclick={() => navigate(page.path)}
        >
          <span>{page.title}</span>
          <small>{page.description}</small>
        </button>
      {/each}
    </div>
  {/if}

  <main class="native-page-host" aria-busy={loading}>
    {#if loading || !ActivePage}
      <div class="native-loading">
        <span>{selected?.title}</span>
        <strong>Loading page source...</strong>
      </div>
    {:else}
      <ActivePage />
    {/if}
  </main>
{/if}
