<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import SceneFrame from "./components/SceneFrame.svelte";
  import TechnicalLabel from "./components/TechnicalLabel.svelte";
  import MeasurementRail from "./components/MeasurementRail.svelte";
  import LayerLegend from "./components/LayerLegend.svelte";
  import ComponentIndex from "./components/ComponentIndex.svelte";
  import TitleBlock from "./components/TitleBlock.svelte";
  import { MACRO_LABELS } from "./data/layerMeta";
  import { formatInteger } from "./lib/format";
  import { mapModelToScenes } from "./lib/sceneMapping";
  import type { BomModelJson } from "./types/bom";
  import type { LayerKey, ParsedModel } from "./types/model";
  import type { CameraBlendState, SceneData, SceneId } from "./types/scene";

  type SceneLayerVisibility = Partial<Record<string, Partial<Record<LayerKey, boolean>>>>;
  type SceneHiddenLayerKeys = Partial<Record<string, Set<LayerKey>>>;
  type SceneProgressMap = Partial<Record<SceneId, number>>;

  let storyEl: HTMLElement;
  let fileInput: HTMLInputElement;
  let modelPathInput: HTMLInputElement;
  let errorEl: HTMLDivElement;
  let model: ParsedModel | null = null;
  let loading = false;
  let error: string | null = null;
  let sourceName: string | null = null;
  let modelPath = "/Model_SBMBOOST_bom_visual_nonPretty-print.json";
  let exploreMode = false;
  let theme: "light" | "dark" = "light";
  let activeSceneId: SceneId = "hero";
  let progress: SceneProgressMap = {};
  let cameraBlend: CameraBlendState = { fromId: "hero", toId: "hero", progress: 1 };
  let sceneLayerVisibility: SceneLayerVisibility = {};
  let hiddenLayerKeysByScene: SceneHiddenLayerKeys = {};
  let reducedMotion = false;
  let scrollRaf = 0;
  let ThreeStageComponent: typeof import("./components/ThreeStage.svelte").default | null = null;
  let disposeModel: ((model: ParsedModel | null) => void) | null = null;

  $: scenes = mapModelToScenes(model);
  $: activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0];
  $: activeProgress = activeScene ? progress[activeScene.id] ?? 0 : 0;
  $: explodedProgress = activeScene?.id === "exploded" ? Math.min(1, Math.max(activeProgress, 0.18)) : 0;
  $: hiddenLayerKeysByScene = buildHiddenLayerKeysByScene(sceneLayerVisibility);
  $: activeHiddenLayerKeys = (activeScene ? hiddenLayerKeysByScene[activeScene.id] : undefined) ?? emptyHiddenLayerKeys;
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
    void tick().then(syncScroll);
  }

  async function loadFile(file: File) {
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

  const emptyHiddenLayerKeys = new Set<LayerKey>();

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

  function clamp(value: number) {
    return Math.min(1, Math.max(0, value));
  }

  function queueScrollSync() {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(syncScroll);
  }

  function syncScroll() {
    scrollRaf = 0;
    if (!storyEl || !scenes.length) return;

    const viewportCenter = window.innerHeight * 0.5;
    let nextActive = scenes[0].id;
    let bestDistance = Number.POSITIVE_INFINITY;
    const nextProgress: SceneProgressMap = {};

    scenes.forEach((scene) => {
      const section = storyEl.querySelector<HTMLElement>(`[data-scene-id="${scene.id}"]`);
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const sectionCenter = rect.top + rect.height * 0.5;
      const distance = Math.abs(sectionCenter - viewportCenter);
      nextProgress[scene.id] = clamp((viewportCenter - rect.top) / Math.max(rect.height, 1));
      if (distance < bestDistance) {
        bestDistance = distance;
        nextActive = scene.id;
      }

      const mobile = window.matchMedia("(max-width: 760px)").matches;
      const intensity = reducedMotion ? 0 : mobile ? 0.42 : 1;
      section.querySelectorAll<HTMLElement>("[data-parallax]").forEach((item) => {
        const depth = Number(item.dataset.depth ?? 0);
        const xDepth = Number(item.dataset.xDepth ?? depth * 0.55);
        const yDepth = Number(item.dataset.yDepth ?? depth);
        const local = (nextProgress[scene.id] ?? 0) * 2 - 1;
        item.style.transform = `translate3d(${local * xDepth * 90 * intensity}px, ${local * yDepth * 130 * intensity}px, 0)`;
      });
    });

    let nextBlend: CameraBlendState = { fromId: nextActive, toId: nextActive, progress: 1 };
    for (let index = 1; index < scenes.length; index += 1) {
      const section = storyEl.querySelector<HTMLElement>(`[data-scene-id="${scenes[index].id}"]`);
      if (!section) continue;
      const rect = section.getBoundingClientRect();
      const value = clamp((window.innerHeight - rect.top) / (window.innerHeight * 0.5));
      if (value > 0 && value < 1) {
        nextBlend = { fromId: scenes[index - 1].id, toId: scenes[index].id, progress: reducedMotion ? Math.round(value) : value };
        break;
      }
      if (value >= 1 && rect.top < window.innerHeight) {
        nextBlend = { fromId: scenes[index - 1].id, toId: scenes[index].id, progress: 1 };
      }
    }

    activeSceneId = nextActive;
    progress = nextProgress;
    cameraBlend = nextBlend;
  }

  function renderFloorLayers(scene: SceneData) {
    return scene.activeLayerKeys.length ? scene.activeLayerKeys : (["keramik_lantai", "cor_lantai", "floor"] as LayerKey[]);
  }

  function applyTheme(nextTheme: "light" | "dark") {
    theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    window.localStorage.setItem("bom-theme", nextTheme);
  }

  function toggleTheme() {
    applyTheme(theme === "dark" ? "light" : "dark");
  }

  onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const savedTheme = window.localStorage.getItem("bom-theme");
    applyTheme(savedTheme === "dark" || savedTheme === "light" ? savedTheme : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    reducedMotion = media.matches;
    const onReducedMotion = () => {
      reducedMotion = media.matches;
      queueScrollSync();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exploreMode = false;
    };

    media.addEventListener("change", onReducedMotion);
    window.addEventListener("scroll", queueScrollSync, { passive: true });
    window.addEventListener("resize", queueScrollSync);
    window.addEventListener("keydown", onKeyDown);
    void loadFromPath();
    void tick().then(syncScroll);

    return () => {
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
      media.removeEventListener("change", onReducedMotion);
      window.removeEventListener("scroll", queueScrollSync);
      window.removeEventListener("resize", queueScrollSync);
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  onDestroy(() => {
    if (model) disposeModel?.(model);
  });
</script>

<div
  class={`app-shell ${exploreMode ? "is-exploring" : ""}`.trim()}
  role="region"
  aria-label="Building anatomy viewer"
  on:dragover={(event) => event.preventDefault()}
  on:drop={handleDrop}
>
  {#if !model}
    <a class="skip-link" href="#model-input">Skip to model input</a>
  {:else}
    <a class="skip-link" href="#story">Skip to story</a>
  {/if}
  {#if !model}
    <div class="model-loader" aria-busy={loading}>
      <form id="model-input" class="model-loader__panel" aria-live="polite" on:submit|preventDefault={loadFromPath}>
        <span class="scene-kicker">BOM model input</span>
        <h1>Living Architectural Section</h1>
        <p>Load a BOM Engine JSON first. The 3D scene is created only after input, so the app avoids parsing and WebGL work on first paint.</p>
        <div class="model-loader__form">
          <label class="model-loader__row">
            <span>Model path</span>
            <input bind:this={modelPathInput} bind:value={modelPath} type="text" name="model-path" autocomplete="off" spellcheck="false" />
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
  {:else}
    <div class="model-status" data-parallax data-depth="0.04">
      <div>
        <strong>{sourceName}</strong>
        <span>{formatInteger(model.meshCount)} meshes / {Object.keys(model.layerRegistry).length} layers</span>
      </div>
      <label class="file-button">
        Upload JSON
        <input type="file" accept=".json,application/json" on:change={handleFileInput} />
      </label>
    </div>
  {/if}

  <div class="control-rail" aria-label="Viewer controls">
    <button class="theme-toggle" type="button" aria-pressed={theme === "dark"} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} on:click={toggleTheme}>
      {theme === "dark" ? "Light" : "Dark"}
    </button>
    <button class="explore-toggle" type="button" disabled={!model} aria-pressed={exploreMode} on:click={() => (exploreMode = !exploreMode)}>
      <span class="explore-toggle__dot"></span>
      {exploreMode ? "Exit model" : "Explore model"}
    </button>
  </div>
  {#if exploreMode}
    <div class="explore-hint">Drag to inspect. Wheel zoom is enabled only here. Press Esc to exit.</div>
  {/if}

  {#if model && activeScene && ThreeStageComponent}
    <svelte:component
      this={ThreeStageComponent}
      {model}
      {scenes}
      {cameraBlend}
      {exploreMode}
      {theme}
      activeScene={activeScene}
      sceneProgress={explodedProgress}
      hiddenLayerKeys={activeHiddenLayerKeys}
    />
  {/if}

  {#if model}
  <main id="story" class="story-shell" bind:this={storyEl}>
    {#each scenes as scene, index (scene.id)}
      {@const hiddenLayerKeys = hiddenLayerKeysByScene[scene.id] ?? emptyHiddenLayerKeys}
      <SceneFrame {scene} active={scene.id === activeScene?.id}>
        {#if scene.id === "hero"}
          <div class="scene-grid scene-grid--hero" data-parallax data-depth="0.03"></div>
          <div class="hero-copy" data-parallax data-depth="0.1">
            <span class="scene-kicker">{scene.subtitle}</span>
            <h1>Living Architectural Section</h1>
            <p>{scene.description}</p>
            <div class="hero-specs">
              {#each scene.specs ?? [] as spec (spec.label)}
                <TechnicalLabel label={spec.label} value={spec.value} />
              {/each}
            </div>
          </div>
          <MeasurementRail label="overall section" ticks={8} />
          <LayerLegend {scene} {model} compact {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
          <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          <TitleBlock {scene} {index} />
        {:else if scene.id === "exploded"}
          <div class="exploded-axis" data-parallax data-depth="0.05"></div>
          <div class="scene-copy scene-copy--narrow" data-parallax data-depth="0.12">
            <span class="scene-kicker">{scene.category}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
          </div>
          <div class="exploded-index" data-parallax data-depth="0.22">
            {#if model}
              {#each Object.values(model.macros).filter((macro) => macro.layerKeys.length) as macro, macroIndex (macro.key)}
                <div class={`exploded-index__row exploded-index__row--${macro.key}`}>
                  <span>{String(macroIndex + 1).padStart(2, "0")}</span>
                  <strong>{MACRO_LABELS[macro.key]}</strong>
                  <em>{macro.layerKeys.length} layers</em>
                </div>
              {/each}
            {:else}
              {#each ["roof", "walls", "structure", "floor", "foundation"] as macro, macroIndex (macro)}
                <div class="exploded-index__row">
                  <span>{String(macroIndex + 1).padStart(2, "0")}</span>
                  <strong>{macro}</strong>
                  <em>waiting</em>
                </div>
              {/each}
            {/if}
          </div>
          <div class="spec-strip" data-parallax data-depth="0.16">
            {#each scene.specs ?? [] as spec (spec.label)}
              <TechnicalLabel label={spec.label} value={spec.value} />
            {/each}
          </div>
          <TitleBlock {scene} {index} />
        {:else if scene.id === "roof"}
          <div class="roof-plane" data-parallax data-depth="0.22" data-x-depth="-0.35"></div>
          <div class="scene-copy scene-copy--right" data-parallax data-depth="0.18">
            <span class="scene-kicker">{scene.subtitle}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <div class="inline-specs">
              {#each scene.specs ?? [] as spec (spec.label)}
                <TechnicalLabel label={spec.label} value={spec.value} />
              {/each}
            </div>
          </div>
          <MeasurementRail orientation="horizontal" label="ridge datum" ticks={9} />
          <LayerLegend {scene} {model} {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
          <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          <TitleBlock {scene} {index} />
        {:else if scene.id === "openings"}
          <div class="scene-copy scene-copy--left" data-parallax data-depth="0.15">
            <span class="scene-kicker">{scene.category}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <LayerLegend {scene} {model} {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
            {#each scene.specs ?? [] as spec (spec.label)}
              <TechnicalLabel label={spec.label} value={spec.value} />
            {/each}
          </div>
          <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          <MeasurementRail label="human scale" ticks={6} />
          <TitleBlock {scene} {index} />
        {:else if scene.id === "wall"}
          <div class="section-plane section-plane--wall" data-parallax data-depth="0.06"></div>
          <div class="wall-section-lines" data-parallax data-depth="0.08">
            {#each scene.activeLayerKeys.filter((layerKey) => !hiddenLayerKeys.has(layerKey)).map((layerKey) => model?.layerRegistry[layerKey]).filter(Boolean) as layer (layer!.key)}
              <span>{layer!.label}</span>
            {/each}
          </div>
          <div class="scene-copy scene-copy--right scene-copy--tall" data-parallax data-depth="0.14">
            <span class="scene-kicker">{scene.subtitle}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <LayerLegend {scene} {model} {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
          </div>
          <div class="wall-specs" data-parallax data-depth="0.24">
            {#each scene.specs ?? [] as spec (spec.label)}
              <TechnicalLabel label={spec.label} value={spec.value} />
            {/each}
          </div>
          <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          <TitleBlock {scene} {index} />
        {:else if scene.id === "structure"}
          <div class="structure-grid" data-parallax data-depth="0.07"></div>
          <div class="load-paths" data-parallax data-depth="0.2"><span></span><span></span><span></span></div>
          <div class="scene-copy scene-copy--left" data-parallax data-depth="0.13">
            <span class="scene-kicker">{scene.subtitle}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <LayerLegend {scene} {model} {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
          </div>
          <div class="structure-specs" data-parallax data-depth="0.18">
            {#each scene.specs ?? [] as spec (spec.label)}
              <TechnicalLabel label={spec.label} value={spec.value} />
            {/each}
          </div>
          <MeasurementRail orientation="horizontal" label="grid bay" ticks={11} />
          <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          <TitleBlock {scene} {index} />
        {:else if scene.id === "floor"}
          <div class="floor-strata" data-parallax data-depth="0.16">
            {#each renderFloorLayers(scene).filter((layerKey) => !hiddenLayerKeys.has(layerKey)) as layerKey, layerIndex (layerKey)}
              <span
                style={`--band-index: ${layerIndex}`}
                data-parallax
                data-depth={String(0.08 + layerIndex * 0.04)}
                data-x-depth={String(layerIndex % 2 ? -0.18 : 0.18)}
              >
                {model?.layerRegistry[layerKey]?.label ?? layerKey}
              </span>
            {/each}
          </div>
          <div class="scene-copy scene-copy--right" data-parallax data-depth="0.12">
            <span class="scene-kicker">{scene.category}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <LayerLegend {scene} {model} {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
          </div>
          <div class="floor-specs" data-parallax data-depth="0.22">
            {#each scene.specs ?? [] as spec (spec.label)}
              <TechnicalLabel label={spec.label} value={spec.value} />
            {/each}
          </div>
          <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          <TitleBlock {scene} {index} />
        {:else if scene.id === "foundation"}
          <div class="soil-section" data-parallax data-depth="-0.2" data-y-depth="-0.32"><span></span><span></span><span></span><span></span></div>
          <MeasurementRail label="depth ruler" ticks={10} />
          <div class="scene-copy scene-copy--left scene-copy--low" data-parallax data-depth="0.12">
            <span class="scene-kicker">{scene.subtitle}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <LayerLegend {scene} {model} {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
          </div>
          <div class="foundation-specs" data-parallax data-depth="0.22">
            {#each scene.specs ?? [] as spec (spec.label)}
              <TechnicalLabel label={spec.label} value={spec.value} />
            {/each}
          </div>
          <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          <TitleBlock {scene} {index} />
        {:else if scene.id === "final"}
          <div class="final-register" data-parallax data-depth="0.05"><span></span><span></span><span></span></div>
          <div class="final-summary" data-parallax data-depth="0.1">
            <span class="scene-kicker">{scene.subtitle}</span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <div class="final-summary__stats">
              {#each scene.specs ?? [] as spec (spec.label)}
                <TechnicalLabel label={spec.label} value={spec.value} />
              {/each}
            </div>
            <LayerLegend {scene} {model} compact {hiddenLayerKeys} toggleLayer={(layerKey) => toggleLayer(scene.id, layerKey)} />
            <ComponentIndex {scene} {model} {hiddenLayerKeys} />
          </div>
          <TitleBlock {scene} {index} />
        {/if}
      </SceneFrame>
    {/each}
  </main>
  {/if}
</div>
