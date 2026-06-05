<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import LayerLegend from "./components/LayerLegend.svelte";
  import ComponentIndex from "./components/ComponentIndex.svelte";
  import TechnicalLabel from "./components/TechnicalLabel.svelte";
  import { MACRO_LABELS } from "./data/layerMeta";
  import { formatInteger } from "./lib/format";
  import { mapModelToScenes } from "./lib/sceneMapping";
  import type { BomModelJson } from "./types/bom";
  import type { LayerKey, ParsedModel } from "./types/model";
  import type { CameraBlendState, SceneId } from "./types/scene";

  type SceneLayerVisibility = Partial<Record<string, Partial<Record<LayerKey, boolean>>>>;
  type SceneHiddenLayerKeys = Partial<Record<string, Set<LayerKey>>>;

  let fileInput: HTMLInputElement;
  let errorEl: HTMLDivElement;
  let model: ParsedModel | null = null;
  let loading = false;
  let error: string | null = null;
  let sourceName: string | null = null;
  let modelPath = `${import.meta.env.BASE_URL}Model_SBMBOOST_bom_visual_nonPretty-print.json`;
  let exploreMode = false;
  let theme: "light" | "dark" = "light";
  let activeSceneId: SceneId = "hero";
  let sceneLayerVisibility: SceneLayerVisibility = {};
  let hiddenLayerKeysByScene: SceneHiddenLayerKeys = {};
  let ThreeStageComponent: typeof import("./components/ThreeStage.svelte").default | null = null;
  let disposeModel: ((model: ParsedModel | null) => void) | null = null;
  const MAX_MODEL_FILE_BYTES = 60 * 1024 * 1024;

  const emptyHiddenLayerKeys = new Set<LayerKey>();

  $: scenes = mapModelToScenes(model);
  $: activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0];
  $: cameraBlend = activeScene
    ? ({ fromId: activeScene.id, toId: activeScene.id, progress: 1 } satisfies CameraBlendState)
    : ({ fromId: "hero", toId: "hero", progress: 1 } satisfies CameraBlendState);
  $: sceneProgress = activeScene?.displayMode === "exploded" ? 1 : 0;
  $: hiddenLayerKeysByScene = buildHiddenLayerKeysByScene(sceneLayerVisibility);
  $: activeHiddenLayerKeys = (activeScene ? hiddenLayerKeysByScene[activeScene.id] : undefined) ?? emptyHiddenLayerKeys;
  $: activeMacroLabel = activeScene
    ? activeScene.macroGroup === "all"
      ? "Full model"
      : MACRO_LABELS[activeScene.macroGroup]
    : "Loading";
  $: visibleLayerCount = activeScene?.activeLayerKeys.filter((layerKey) => !activeHiddenLayerKeys.has(layerKey)).length ?? 0;
  $: if (model && !ThreeStageComponent) {
    void import("./components/ThreeStage.svelte").then((module) => {
      ThreeStageComponent = module.default;
    });
  }

  function normalizeError(value: unknown): string {
    if (value instanceof Error) return value.message;
    return "Unable to load BOM model.";
  }

  async function commitModel(data: BomModelJson, name: string) {
    const previous = model;
    const [{ parseBomModel }, { disposeParsedModel }] = await Promise.all([
      import("./lib/parseBomModel"),
      import("./lib/computeModelBounds")
    ]);
    disposeModel = disposeParsedModel;
    const parsed = parseBomModel(data, name);
    model = parsed;
    sourceName = name;
    error = null;
    sceneLayerVisibility = {};
    if (previous) disposeParsedModel(previous);
    await tick();
  }

  async function loadFile(file: File) {
    if (file.size > MAX_MODEL_FILE_BYTES) {
      error = `File too large. Maximum ${Math.round(MAX_MODEL_FILE_BYTES / 1024 / 1024)} MB.`;
      await tick();
      errorEl?.focus();
      return;
    }
    loading = true;
    error = null;
    try {
      const text = await file.text();
      await commitModel(JSON.parse(text) as BomModelJson, file.name);
    } catch (loadError) {
      error = normalizeError(loadError);
      await tick();
      errorEl?.focus();
    } finally {
      loading = false;
    }
  }

  async function loadFromPath() {
    loading = true;
    error = null;
    try {
      const response = await fetch(modelPath, { cache: "no-store" });
      if (!response.ok) throw new Error(`Cannot load ${modelPath}: ${response.status}`);
      await commitModel((await response.json()) as BomModelJson, modelPath.replace(/^\//, ""));
    } catch (loadError) {
      error = normalizeError(loadError);
      await tick();
      errorEl?.focus();
    } finally {
      loading = false;
    }
  }

  function handleFileInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void loadFile(file);
    input.value = "";
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) => candidate.name.endsWith(".json"));
    if (file) void loadFile(file);
  }

  function buildHiddenLayerKeysByScene(visibility: SceneLayerVisibility) {
    const hiddenByScene: SceneHiddenLayerKeys = {};
    Object.entries(visibility).forEach(([sceneId, sceneVisibility]) => {
      hiddenByScene[sceneId] = new Set(
        Object.entries(sceneVisibility ?? {})
          .filter(([, enabled]) => enabled === false)
          .map(([layerKey]) => layerKey as LayerKey)
      );
    });
    return hiddenByScene;
  }

  function setActiveScene(sceneId: SceneId) {
    activeSceneId = sceneId;
  }

  function toggleLayer(sceneId: string, layerKey: LayerKey) {
    const currentScene = sceneLayerVisibility[sceneId] ?? {};
    const nextEnabled = currentScene[layerKey] === false;
    sceneLayerVisibility = {
      ...sceneLayerVisibility,
      [sceneId]: {
        ...currentScene,
        [layerKey]: nextEnabled
      }
    };
  }

  function applyTheme(nextTheme: "light" | "dark") {
    theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = "light";
    window.localStorage.setItem("bom-theme", nextTheme);
  }

  function toggleTheme() {
    applyTheme(theme === "dark" ? "light" : "dark");
  }

  onMount(() => {
    const savedTheme = window.localStorage.getItem("bom-theme");
    applyTheme(savedTheme === "dark" || savedTheme === "light" ? savedTheme : "light");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exploreMode = false;
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  onDestroy(() => {
    if (model) disposeModel?.(model);
  });
</script>

<div
  class={`app-shell board-shell ${exploreMode ? "is-exploring" : ""}`.trim()}
  role="region"
  aria-label="Neobrutal building renderer"
  on:dragover={(event) => event.preventDefault()}
  on:drop={handleDrop}
>
  <a class="skip-link" href="#board-controls">Skip to controls</a>

  {#if model && activeScene && ThreeStageComponent}
    <svelte:component
      this={ThreeStageComponent}
      {model}
      {scenes}
      {cameraBlend}
      {exploreMode}
      {theme}
      {sceneProgress}
      activeScene={activeScene}
      hiddenLayerKeys={activeHiddenLayerKeys}
    />
  {/if}

  <header class="board-topbar">
    <div class="board-mark">
      <span>SBM BOM</span>
      <strong>CLAY RENDER BOARD</strong>
    </div>
    <div class="board-actions" aria-label="Renderer controls">
      <label class="file-button">
        Upload JSON
        <input bind:this={fileInput} type="file" accept=".json,application/json" on:change={handleFileInput} />
      </label>
      <button class="theme-toggle" type="button" aria-pressed={theme === "dark"} aria-label="Toggle board contrast" on:click={toggleTheme}>
        Contrast
      </button>
      <button class="explore-toggle" type="button" disabled={!model} aria-pressed={exploreMode} on:click={() => (exploreMode = !exploreMode)}>
        <span class="explore-toggle__dot"></span>
        {exploreMode ? "Lock camera" : "Orbit"}
      </button>
    </div>
  </header>

  {#if !model}
    <div class="model-loader" aria-busy={loading}>
      <form id="model-input" class="model-loader__panel" aria-live="polite" on:submit|preventDefault={loadFromPath}>
        <span class="scene-kicker">BOM model input</span>
        <h1>Clay render board</h1>
        <p>Loading source model into the neobrutal presentation renderer.</p>
        <div class="model-loader__form">
          <label class="model-loader__row">
            <span>Model path</span>
            <input bind:value={modelPath} type="text" name="model-path" autocomplete="off" spellcheck="false" />
          </label>
          <div class="model-loader__actions">
            <button class="file-button" type="submit">{loading ? "Loading..." : "Load path"}</button>
            <label class="file-button">
              Upload JSON
              <input bind:this={fileInput} type="file" accept=".json,application/json" on:change={handleFileInput} />
            </label>
          </div>
          {#if error}
            <div bind:this={errorEl} class="model-loader__error" role="alert" tabindex="-1">{error}</div>
          {/if}
        </div>
      </form>
    </div>
  {:else if activeScene}
    <main class="board-layout" id="board-controls">
      <section class="board-panel board-panel--left" aria-label="Presentation scene">
        <div class="panel-stamp">Scene {String(scenes.findIndex((scene) => scene.id === activeScene.id) + 1).padStart(2, "0")}</div>
        <span class="scene-kicker">{activeScene.category} / {activeMacroLabel}</span>
        <h1>{activeScene.title}</h1>
        <p>{activeScene.description}</p>

        <div class="hero-specs">
          {#each activeScene.specs ?? [] as spec (spec.label)}
            <TechnicalLabel label={spec.label} value={spec.value} />
          {/each}
        </div>

        <div class="render-readout">
          <span>Mode <strong>{activeScene.displayMode}</strong></span>
          <span>Visible layers <strong>{visibleLayerCount}</strong></span>
          <span>Source <strong>{sourceName}</strong></span>
        </div>
      </section>

      <section class="board-panel board-panel--right" aria-label="Layer controls">
        <div class="panel-stamp">Layer cut</div>
        <LayerLegend
          scene={activeScene}
          {model}
          hiddenLayerKeys={activeHiddenLayerKeys}
          toggleLayer={(layerKey) => toggleLayer(activeScene.id, layerKey)}
        />
        <ComponentIndex scene={activeScene} {model} hiddenLayerKeys={activeHiddenLayerKeys} />
      </section>

      <nav class="scene-switcher" aria-label="Camera scenes">
        {#each scenes as scene, index (scene.id)}
          <button
            type="button"
            class:active={scene.id === activeScene.id}
            aria-pressed={scene.id === activeScene.id}
            on:click={() => setActiveScene(scene.id)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{scene.title}</strong>
          </button>
        {/each}
      </nav>

      <aside class="board-status" aria-label="Loaded model">
        <strong>{formatInteger(model.meshCount)}</strong>
        <span>meshes / {Object.keys(model.layerRegistry).length} layers</span>
      </aside>
    </main>
  {/if}

  {#if exploreMode}
    <div class="explore-hint">Drag to orbit. Wheel zoom. Esc locks camera.</div>
  {/if}
</div>
