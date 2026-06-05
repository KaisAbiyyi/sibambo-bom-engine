<script lang="ts">
  import type { BomModelJson, ParsedModel } from "../types";
  import { parseBomModel } from "../lib/model";

  export let onModel: (model: ParsedModel) => void;

  let modelPath = `${import.meta.env.BASE_URL}Model_SBMBOOST_bom_visual_nonPretty-print.json`;
  let loading = false;
  let error = "";
  let fileInput: HTMLInputElement;
  const MAX_MODEL_FILE_BYTES = 60 * 1024 * 1024;

  function normalizeError(value: unknown): string {
    return value instanceof Error ? value.message : "Unable to load BOM JSON.";
  }

  async function commit(data: BomModelJson, sourceName: string): Promise<void> {
    const parsed = parseBomModel(data, sourceName);
    onModel(parsed);
  }

  async function loadFromPath(): Promise<void> {
    loading = true;
    error = "";
    try {
      const response = await fetch(modelPath, { cache: "no-store" });
      if (!response.ok) throw new Error(`Cannot load ${modelPath}: ${response.status}`);
      await commit((await response.json()) as BomModelJson, modelPath.replace(/^\//, ""));
    } catch (value) {
      error = normalizeError(value);
    } finally {
      loading = false;
    }
  }

  async function loadFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_MODEL_FILE_BYTES) {
      error = `File too large. Maximum ${Math.round(MAX_MODEL_FILE_BYTES / 1024 / 1024)} MB.`;
      input.value = "";
      return;
    }

    loading = true;
    error = "";
    try {
      await commit(JSON.parse(await file.text()) as BomModelJson, file.name);
    } catch (value) {
      error = normalizeError(value);
    } finally {
      loading = false;
      input.value = "";
    }
  }
</script>

<main class="loader-screen" aria-busy={loading}>
  <div class="loader-grid" aria-hidden="true">
    <span></span><span></span><span></span><span></span>
  </div>

  <section class="loader-copy">
    <p class="mono-label">SBM BOM / Mineral Atlas</p>
    <h1>Load model first. Then inspect material, mass, and layer logic.</h1>
    <p>
      New Svelte4 starts from JSON ingestion. No WebGL work before input. Same BIM
      source, different presentation system.
    </p>
  </section>

  <form class="loader-panel" on:submit|preventDefault={loadFromPath}>
    <div>
      <span class="mono-label">Source path</span>
      <input bind:value={modelPath} type="text" spellcheck="false" autocomplete="off" />
    </div>

    <div class="loader-actions">
      <button type="submit" disabled={loading}>{loading ? "Parsing..." : "Load 3D JSON"}</button>
      <button type="button" on:click={() => fileInput?.click()} disabled={loading}>Upload JSON</button>
      <input bind:this={fileInput} type="file" accept=".json,application/json" on:change={loadFile} />
    </div>

    {#if error}
      <p class="loader-error" role="alert">{error}</p>
    {/if}
  </form>

  <aside class="loader-notes" aria-label="Visual direction">
    <span>dark mineral palette</span>
    <span>merged layer geometry</span>
    <span>GSAP scroll camera</span>
    <span>JSON evidence panels</span>
  </aside>
</main>
