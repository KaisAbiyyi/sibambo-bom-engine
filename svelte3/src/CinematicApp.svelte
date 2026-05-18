<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import LayerLegend from "./components/LayerLegend.svelte";
  import ComponentIndex from "./components/ComponentIndex.svelte";
  import TechnicalLabel from "./components/TechnicalLabel.svelte";
  import { formatInteger } from "./lib/format";
  import { mapModelToScenes } from "./lib/sceneMapping";
  import type { BomModelJson } from "./types/bom";
  import type { LayerKey, ParsedModel } from "./types/model";
  import type { CameraBlendState, SceneData, SceneId } from "./types/scene";

  type SceneLayerVisibility = Partial<Record<string, Partial<Record<LayerKey, boolean>>>>;
  type SceneHiddenLayerKeys = Partial<Record<string, Set<LayerKey>>>;

  type CinematicChapter = {
    id: string;
    sceneId: SceneId;
    kicker: string;
    title: string;
    body: string;
    marker: string;
    align: "left" | "right" | "center";
    overlay: "none" | "massing" | "site" | "cutaway" | "path" | "hotspot" | "night" | "technical" | "explore";
  };

  type CardFrame = {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    paddingX: number;
    paddingY: number;
    titleSize: number;
    titleMax: number;
  };

  const chapters: CinematicChapter[] = [
    {
      id: "reveal",
      sceneId: "hero",
      kicker: "01 / Fullscreen reveal",
      title: "Cinematic architectural scroll",
      body: "The building enters as the main actor: clay mass, fine outline, soft shadow, and slow camera reveal.",
      marker: "Reveal",
      align: "left",
      overlay: "none"
    },
    {
      id: "concept",
      sceneId: "exploded",
      kicker: "02 / Concept massing",
      title: "Layered masses separate",
      body: "Volumes pull apart into a readable exploded diagram, turning the SketchUp model into a concept narrative.",
      marker: "Massing",
      align: "right",
      overlay: "massing"
    },
    {
      id: "site",
      sceneId: "roof",
      kicker: "03 / Site context",
      title: "Isometric site logic",
      body: "The camera lifts into a planning view with clean site intent, access direction, and breathing room around the model.",
      marker: "Site",
      align: "left",
      overlay: "none"
    },
    {
      id: "interior",
      sceneId: "openings",
      kicker: "04 / Spatial experience",
      title: "Cutaway interior read",
      body: "The facade opens conceptually. Interior edges, thresholds, and occupied rooms become legible without over-detailing.",
      marker: "Cut",
      align: "right",
      overlay: "cutaway"
    },
    {
      id: "walkthrough",
      sceneId: "wall",
      kicker: "05 / Guided walkthrough",
      title: "Path camera, not free camera",
      body: "Scroll behaves like a curated walkthrough route: entrance, lobby, courtyard, then rear facade.",
      marker: "Route",
      align: "left",
      overlay: "path"
    },
    {
      id: "hotspot",
      sceneId: "structure",
      kicker: "06 / Detail focus",
      title: "Click-hold style focus",
      body: "Feature cards and focus marks frame facade, circulation, roof, courtyard, and structure as intentional details.",
      marker: "Hotspots",
      align: "right",
      overlay: "hotspot"
    },
    {
      id: "atmosphere",
      sceneId: "floor",
      kicker: "07 / Day night atmosphere",
      title: "Same model, different mood",
      body: "A restrained day/night shift changes background, contrast, and glow while keeping the clay model readable.",
      marker: "Mood",
      align: "left",
      overlay: "night"
    },
    {
      id: "technical",
      sceneId: "foundation",
      kicker: "08 / Technical drawing",
      title: "Blueprint mode enters",
      body: "Dimension bars, section lines, and orthographic composition make the presentation feel serious, not decorative.",
      marker: "Drawing",
      align: "right",
      overlay: "technical"
    },
    {
      id: "explore",
      sceneId: "final",
      kicker: "09 / Free explore",
      title: "Then give control",
      body: "After the story teaches the best views, orbit mode and layer controls unlock for independent inspection.",
      marker: "Explore",
      align: "center",
      overlay: "explore"
    }
  ];

  let storyEl: HTMLElement;
  let fileInput: HTMLInputElement;
  let errorEl: HTMLDivElement;
  let model: ParsedModel | null = null;
  let loading = false;
  let error: string | null = null;
  let sourceName: string | null = null;
  let modelPath = "/Model_SBMBOOST_bom_visual_nonPretty-print.json";
  let exploreMode = false;
  let theme: "light" | "dark" = "light";
  let themeShift = false;
  let activeChapterIndex = 0;
  let activeNavIndex = 0;
  let cameraBlend: CameraBlendState = { fromId: "hero", toId: "hero", progress: 1 };
  let cardStyle = "";
  let cardMorphing = false;
  let morphLocalProgress = 1;
  let forcedChapterIndex: number | null = null;
  let sceneLayerVisibility: SceneLayerVisibility = {};
  let hiddenLayerKeysByScene: SceneHiddenLayerKeys = {};
  let scrollRaf = 0;
  let navTransitionRaf = 0;
  let navTransitioning = false;
  let ThreeStageComponent: typeof import("./components/ThreeStage.svelte").default | null = null;
  let disposeModel: ((model: ParsedModel | null) => void) | null = null;

  const emptyHiddenLayerKeys = new Set<LayerKey>();

  $: scenes = mapModelToScenes(model);
  $: activeChapter = chapters[activeChapterIndex] ?? chapters[0];
  $: activeScene = scenes.find((scene) => scene.id === activeChapter.sceneId) ?? scenes[0];
  $: displaySourceName = formatSourceName(sourceName);
  $: activeHiddenLayerKeys = (activeScene ? hiddenLayerKeysByScene[activeScene.id] : undefined) ?? emptyHiddenLayerKeys;
  $: sceneProgress = activeScene?.displayMode === "exploded" ? 1 : 0;
  $: hiddenLayerKeysByScene = buildHiddenLayerKeysByScene(sceneLayerVisibility);
  $: if (model && !ThreeStageComponent) {
    void import("./components/ThreeStage.svelte").then((module) => {
      ThreeStageComponent = module.default;
    });
  }

  function normalizeError(value: unknown): string {
    if (value instanceof Error) return value.message;
    return "Unable to load BOM model.";
  }

  function formatSourceName(value: string | null) {
    if (!value) return "No model loaded";
    const file = value.split(/[\\/]/).pop() ?? value;
    return file
      .replace(/\.(json|glb|gltf)$/i, "")
      .replace(/^model[_-]*/i, "")
      .replace(/bom[_-]*/i, "BOM ")
      .replace(/visual[_-]*/i, "visual ")
      .replace(/nonpretty[-_ ]*print/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
    syncScroll();
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

  function chooseModel() {
    fileInput?.click();
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(from: number, to: number, progress: number) {
    return from + (to - from) * progress;
  }

  function easeInOut(progress: number) {
    return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  }

  function phase(progress: number, start: number, end: number) {
    return easeInOut(clamp((progress - start) / Math.max(end - start, 0.001), 0, 1));
  }

  function morphProgressForSegment(progress: number) {
    return clamp((progress - 0.38) / 0.52, 0, 1);
  }

  function cardFrameFor(index: number, width = window.innerWidth, height = window.innerHeight): CardFrame {
    const mobile = width < 760;
    const railSpace = width > 980 ? 196 : 24;
    const safeWidth = Math.max(320, width - railSpace - 48);
    const leftX = mobile ? 16 : clamp(width * 0.055, 34, 84);
    const rightWidth = mobile ? width - 32 : Math.min(500, safeWidth);
    const rightX = mobile ? 16 : Math.max(28, width - railSpace - rightWidth);
    const heroWidth = mobile ? width - 32 : Math.min(560, safeWidth);

    const frames: CardFrame[] = [
      { x: leftX, y: mobile ? 104 : height * 0.16, width: heroWidth, height: mobile ? 430 : 490, radius: 34, paddingX: mobile ? 24 : 46, paddingY: mobile ? 24 : 38, titleSize: mobile ? 40 : 60, titleMax: 12 },
      { x: rightX, y: mobile ? 108 : height * 0.1, width: rightWidth * 0.9, height: mobile ? 370 : 390, radius: 48, paddingX: 34, paddingY: 32, titleSize: mobile ? 36 : 48, titleMax: 10 },
      { x: rightX, y: mobile ? 118 : height * 0.18, width: rightWidth, height: mobile ? 350 : 370, radius: 24, paddingX: 32, paddingY: 30, titleSize: mobile ? 32 : 44, titleMax: 12 },
      { x: rightX, y: mobile ? 104 : height * 0.13, width: rightWidth * 0.96, height: mobile ? 290 : 300, radius: 42, paddingX: mobile ? 24 : 34, paddingY: 24, titleSize: mobile ? 28 : 36, titleMax: 14 },
      { x: leftX, y: mobile ? 118 : height * 0.18, width: mobile ? width - 32 : Math.min(520, safeWidth), height: mobile ? 320 : 330, radius: 26, paddingX: 30, paddingY: 28, titleSize: mobile ? 30 : 38, titleMax: 13 },
      { x: rightX, y: mobile ? 120 : height * 0.16, width: rightWidth * 0.82, height: mobile ? 330 : 350, radius: 52, paddingX: 32, paddingY: 30, titleSize: mobile ? 31 : 40, titleMax: 10 },
      { x: leftX, y: mobile ? 114 : height * 0.16, width: mobile ? width - 32 : Math.min(500, safeWidth), height: mobile ? 360 : 390, radius: 30, paddingX: 34, paddingY: 32, titleSize: mobile ? 32 : 44, titleMax: 11 },
      { x: rightX, y: mobile ? 118 : height * 0.2, width: rightWidth * 0.92, height: mobile ? 300 : 300, radius: 12, paddingX: 32, paddingY: 26, titleSize: mobile ? 30 : 38, titleMax: 14 },
      { x: rightX, y: mobile ? 114 : height * 0.15, width: mobile ? width - 32 : Math.min(380, safeWidth), height: mobile ? 430 : 460, radius: 30, paddingX: 22, paddingY: 22, titleSize: mobile ? 28 : 36, titleMax: 9 }
    ];

    return frames[index] ?? frames[0];
  }

  function syncMorphCard(fromIndex: number, toIndex: number, progress: number) {
    const from = cardFrameFor(fromIndex);
    const to = cardFrameFor(toIndex);
    const transitioning = fromIndex !== toIndex && progress > 0 && progress < 1;
    const localProgress = transitioning ? morphProgressForSegment(progress) : 1;
    const moving = transitioning && localProgress > 0.02 && localProgress < 0.98;
    morphLocalProgress = localProgress;
    const slimHeight = clamp(Math.min(from.height, to.height) * 0.18, 76, 118);
    const slimWidth = clamp(Math.min(from.width, to.width) * 0.62, 260, 420);
    const cornerX = from.x;
    const cornerY = to.y;
    const movingRight = to.x >= from.x;
    const stretchLeft = movingRight ? cornerX : to.x;
    const stretchRight = movingRight ? to.x + to.width : cornerX + slimWidth;
    const stretchWidth = Math.max(slimWidth, stretchRight - stretchLeft);
    const stretchProgress = phase(localProgress, 0.32, 0.58);
    const shrinkProgress = phase(localProgress, 0.58, 0.78);
    const growProgress = phase(localProgress, 0.78, 1);
    const cornerProgress = phase(localProgress, 0.12, 0.32);

    let x = transitioning ? lerp(from.x, cornerX, cornerProgress) : from.x;
    let y = transitioning ? lerp(from.y, cornerY, cornerProgress) : from.y;
    let currentWidth = transitioning ? lerp(from.width, slimWidth, cornerProgress) : from.width;
    let currentHeight = transitioning ? lerp(from.height, slimHeight, cornerProgress) : from.height;

    if (transitioning && localProgress >= 0.32) {
      x = movingRight ? stretchLeft : lerp(cornerX, stretchLeft, stretchProgress);
      y = cornerY;
      currentWidth = lerp(slimWidth, stretchWidth, stretchProgress);
      currentHeight = slimHeight;
    }

    if (transitioning && localProgress >= 0.58) {
      currentWidth = lerp(stretchWidth, to.width, shrinkProgress);
      x = movingRight ? stretchRight - currentWidth : stretchLeft;
      y = cornerY;
      currentHeight = slimHeight;
    }

    if (transitioning && localProgress >= 0.78) {
      x = to.x;
      y = to.y;
      currentWidth = to.width;
      currentHeight = lerp(slimHeight, to.height, growProgress);
    }

    const styleProgress = transitioning ? phase(localProgress, 0.78, 1) : 1;
    const radius = transitioning ? lerp(from.radius, to.radius, styleProgress) : from.radius;
    const paddingX = transitioning ? lerp(from.paddingX, to.paddingX, styleProgress) : from.paddingX;
    const paddingY = transitioning ? lerp(from.paddingY, to.paddingY, styleProgress) : from.paddingY;
    const titleSize = transitioning ? lerp(from.titleSize, to.titleSize, styleProgress) : from.titleSize;
    const titleMax = transitioning ? lerp(from.titleMax, to.titleMax, styleProgress) : from.titleMax;

    cardMorphing = moving;
    cardStyle = [
      `--morph-x: ${x.toFixed(2)}px`,
      `--morph-y: ${y.toFixed(2)}px`,
      `--morph-w: ${currentWidth.toFixed(2)}px`,
      `--morph-h: ${currentHeight.toFixed(2)}px`,
      `--morph-radius: ${radius.toFixed(2)}px`,
      `--morph-pad-x: ${paddingX.toFixed(2)}px`,
      `--morph-pad-y: ${paddingY.toFixed(2)}px`,
      `--morph-title: ${titleSize.toFixed(2)}px`,
      `--morph-title-max: ${titleMax.toFixed(2)}ch`,
      "--morph-scale-x: 1",
      "--morph-scale-y: 1"
    ].join("; ");
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

  function queueScrollSync() {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(syncScroll);
  }

  function syncScroll() {
    scrollRaf = 0;
    if (navTransitioning) return;
    if (!storyEl) return;

    const sections = Array.from(storyEl.querySelectorAll<HTMLElement>("[data-chapter-index]"));
    if (!sections.length) return;

    const viewportCenter = window.innerHeight * 0.5;
    const centers: number[] = [];

    sections.forEach((section, index) => {
      const rect = section.getBoundingClientRect();
      const center = rect.top + rect.height * 0.5;
      centers[index] = center;
      const distance = Math.abs(center - viewportCenter);
      const visibility = Math.max(0, 1 - distance / Math.max(window.innerHeight * 0.78, 1));
      const phase = Math.min(1, Math.max(0, (viewportCenter - rect.top) / Math.max(rect.height, 1)));
      section.style.setProperty("--chapter-visibility", String(visibility));
      section.style.setProperty("--chapter-phase", String(phase));
      section.style.setProperty("--chapter-y", `${(1 - visibility) * 42}px`);
      section.style.setProperty("--chapter-scale", String(0.94 + visibility * 0.06));
      section.style.setProperty("--chapter-opacity", String(0.2 + visibility * 0.8));
    });

    let fromIndex = 0;
    let toIndex = 0;
    let rawBlendProgress = 1;

    if (viewportCenter <= centers[0]) {
      fromIndex = 0;
      toIndex = 0;
    } else if (viewportCenter >= centers[centers.length - 1]) {
      fromIndex = centers.length - 1;
      toIndex = centers.length - 1;
    } else {
      for (let index = 0; index < centers.length - 1; index += 1) {
        const start = centers[index];
        const end = centers[index + 1];
        if (viewportCenter >= start && viewportCenter <= end) {
          fromIndex = index;
          toIndex = index + 1;
          rawBlendProgress = clamp((viewportCenter - start) / Math.max(end - start, 1), 0, 1);
          break;
        }
      }
    }

    const blendProgress = fromIndex === toIndex ? 1 : rawBlendProgress;
    const displayIndex =
      forcedChapterIndex ?? (fromIndex === toIndex ? fromIndex : morphProgressForSegment(rawBlendProgress) > 0.96 ? toIndex : fromIndex);

    const nextTheme = chapters[displayIndex].overlay === "night" ? "dark" : "light";
    if (nextTheme !== theme) {
      themeShift = true;
      window.setTimeout(() => {
        themeShift = false;
      }, 520);
    }

    activeChapterIndex = displayIndex;
    activeNavIndex = displayIndex;
    cameraBlend = {
      fromId: chapters[fromIndex].sceneId,
      toId: chapters[toIndex].sceneId,
      progress: blendProgress
    };
    syncMorphCard(fromIndex, toIndex, blendProgress);

    theme = nextTheme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  }

  function jumpToChapter(index: number) {
    const target = storyEl?.querySelector<HTMLElement>(`[data-chapter-index="${index}"]`);
    if (!target) return;
    const fromIndex = activeChapterIndex;
    const toIndex = clamp(index, 0, chapters.length - 1);
    const top = window.scrollY + target.getBoundingClientRect().top + target.offsetHeight * 0.5 - window.innerHeight * 0.5;

    if (navTransitionRaf) window.cancelAnimationFrame(navTransitionRaf);
    if (scrollRaf) {
      window.cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    }

    forcedChapterIndex = toIndex;
    activeNavIndex = toIndex;
    activeChapterIndex = toIndex;
    navTransitioning = fromIndex !== toIndex;

    if (!navTransitioning) {
      syncMorphCard(toIndex, toIndex, 1);
      cameraBlend = { fromId: chapters[toIndex].sceneId, toId: chapters[toIndex].sceneId, progress: 1 };
      window.scrollTo({ top, behavior: "auto" });
      forcedChapterIndex = null;
      return;
    }

    const start = performance.now();
    const duration = 1320;
    const fromSceneId = chapters[fromIndex].sceneId;
    const toSceneId = chapters[toIndex].sceneId;

    const tickNavTransition = (time: number) => {
      const raw = clamp((time - start) / duration, 0, 1);
      const eased = easeInOut(raw);
      activeChapterIndex = toIndex;
      activeNavIndex = toIndex;
      cameraBlend = { fromId: fromSceneId, toId: toSceneId, progress: eased };
      syncMorphCard(fromIndex, toIndex, eased);

      if (raw < 1) {
        navTransitionRaf = window.requestAnimationFrame(tickNavTransition);
        return;
      }

      navTransitionRaf = 0;
      navTransitioning = false;
      forcedChapterIndex = null;
      activeChapterIndex = toIndex;
      activeNavIndex = toIndex;
      morphLocalProgress = 1;
      cardMorphing = false;
      cameraBlend = { fromId: toSceneId, toId: toSceneId, progress: 1 };
      syncMorphCard(toIndex, toIndex, 1);
      window.scrollTo({ top, behavior: "auto" });
      queueScrollSync();
    };

    navTransitionRaf = window.requestAnimationFrame(tickNavTransition);
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exploreMode = false;
    };

    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
    window.addEventListener("scroll", queueScrollSync, { passive: true });
    window.addEventListener("resize", queueScrollSync);
    window.addEventListener("keydown", onKeyDown);
    syncMorphCard(0, 0, 1);

    return () => {
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
      if (navTransitionRaf) window.cancelAnimationFrame(navTransitionRaf);
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
  class={`cinematic-shell cinematic-shell--${activeChapter.overlay}`}
  class:is-exploring={exploreMode}
  class:is-theme-shifting={themeShift}
  role="region"
  aria-label="Cinematic architectural scroll"
>
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

  {#if !model}
    <main class="cinematic-loader">
      <form class="cinematic-loader__panel" on:submit|preventDefault={loadFromPath}>
        <span>Architectural story input</span>
        <h1>Cinematic scroll starts with the model.</h1>
        <p>Load BOM JSON first. After that the building becomes the actor and scroll becomes the camera path.</p>
        <label>
          <span>3D JSON model path</span>
          <input bind:value={modelPath} type="text" spellcheck="false" autocomplete="off" />
        </label>
        <div class="cinematic-loader__actions">
          <button type="submit">{loading ? "Loading..." : "Load model"}</button>
          <label class="cinematic-file">
            Upload JSON
            <input bind:this={fileInput} type="file" accept=".json,application/json" on:change={handleFileInput} />
          </label>
        </div>
        {#if error}
          <div bind:this={errorEl} class="cinematic-error" role="alert" tabindex="-1">{error}</div>
        {/if}
      </form>
    </main>
  {:else}
    <header class="cinematic-header">
      <button type="button" class="brand-button" on:click={() => jumpToChapter(0)}>
        <span>SketchUp BIM story</span>
        <strong>{displaySourceName}</strong>
      </button>
      <div class="cinematic-header__meta">
        <span>{formatInteger(model.meshCount)} meshes</span>
        <span>{Object.keys(model.layerRegistry).length} layers</span>
      </div>
      <div class="header-actions">
        <button type="button" on:click={chooseModel}>Change model</button>
        <label class="header-file">
          <input bind:this={fileInput} type="file" accept=".json,application/json" on:change={handleFileInput} />
        </label>
        <button type="button" class:active={exploreMode} on:click={() => (exploreMode = !exploreMode)}>
          {exploreMode ? "Lock camera" : "Orbit assist"}
        </button>
      </div>
    </header>

    <div class="cinematic-overlays" aria-hidden="true">
      <div class="route-line"><span></span><span></span><span></span></div>
      <div class="section-cut"></div>
      <div class="hotspot-map"><i></i><i></i><i></i><i></i></div>
      <div class="technical-lines"><span></span><span></span><span></span></div>
    </div>

    <nav class="chapter-rail" aria-label="Presentation chapters">
      {#each chapters as chapter, index (chapter.id)}
        <button
          type="button"
          class:active={index === activeNavIndex}
          aria-label={`Jump to ${chapter.marker}`}
          aria-pressed={index === activeNavIndex}
          on:click={() => jumpToChapter(index)}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{chapter.marker}</strong>
        </button>
      {/each}
    </nav>

    {#if activeScene}
      <article
        class="morph-card"
        class:morph-card--moving={cardMorphing}
        class:morph-card--content-ready={morphLocalProgress > 0.96}
        class:morph-card--explore={activeChapter.overlay === "explore"}
        style={cardStyle}
      >
        <div class="morph-card__content">
          <span>{activeChapter.kicker}</span>
          <h1>{activeChapter.title}</h1>
          <p>{activeChapter.body}</p>
          {#if activeChapter.overlay === "explore"}
            <div class="explore-panel">
              <LayerLegend
                scene={activeScene}
                {model}
                compact={true}
                hiddenLayerKeys={activeHiddenLayerKeys}
                toggleLayer={(layerKey) => toggleLayer(activeScene.id, layerKey)}
              />
              <ComponentIndex scene={activeScene} {model} hiddenLayerKeys={activeHiddenLayerKeys} />
            </div>
          {:else}
            <div class="chapter-specs">
              {#each activeScene.specs ?? [] as spec (spec.label)}
                <TechnicalLabel label={spec.label} value={spec.value} />
              {/each}
            </div>
          {/if}
        </div>
      </article>
    {/if}

    <main bind:this={storyEl} class="cinematic-story">
      {#each chapters as chapter, index (chapter.id)}
        <section
          class={`cinematic-chapter cinematic-chapter--${chapter.align} cinematic-chapter--${chapter.overlay} cinematic-chapter--${chapter.id}`}
          data-chapter-index={index}
          aria-label={chapter.title}
        ></section>
      {/each}
    </main>
  {/if}
</div>
