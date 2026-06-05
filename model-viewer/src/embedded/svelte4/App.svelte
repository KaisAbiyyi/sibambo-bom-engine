<script lang="ts">
  import { tick } from "svelte";
  import { gsap } from "gsap";
  import { ScrollTrigger } from "gsap/ScrollTrigger";
  import CanvasStage from "./components/CanvasStage.svelte";
  import LayerLedger from "./components/LayerLedger.svelte";
  import Loader from "./components/Loader.svelte";
  import { MACRO_LABELS, type MacroKey } from "./data/layers";
  import { formatArea, formatNumber } from "./lib/model";
  import type { LayerStat, ParsedModel } from "./types";

  let model: ParsedModel | null = null;
  let selectedLayer = "";
  let selectedMacro: MacroKey | "" = "";
  let exploreMode = false;
  let activeChapter = 0;
  let motionCleanup: (() => void) | null = null;

  gsap.registerPlugin(ScrollTrigger);

  $: selectedLayerInfo = model?.layers.find((layer) => layer.key === selectedLayer) ?? null;
  $: dominantLayers = model ? [...model.layers].sort((a, b) => b.areaM2 - a.areaM2).slice(0, 6) : [];
  $: histogram = Object.entries(model?.document.topLevelHistogram ?? {});

  function selectLayer(key: string): void {
    selectedLayer = selectedLayer === key ? "" : key;
    const layer = model?.layers.find((item) => item.key === key);
    if (layer) selectedMacro = layer.macro;
  }

  function selectMacro(key: string): void {
    selectedMacro = selectedMacro === key ? "" : (key as MacroKey);
    if (selectedMacro) {
      selectedLayer = model?.layers.find((layer) => layer.macro === selectedMacro)?.key ?? "";
    }
  }

  function handleModel(next: ParsedModel): void {
    model = next;
    selectedLayer = next.layers[0]?.key ?? "";
    selectedMacro = "";
    exploreMode = false;
    void tick().then(setupStoryMotion);
  }

  function setupStoryMotion(): void {
    motionCleanup?.();
    const triggers: ScrollTrigger[] = [];

    document.querySelectorAll<HTMLElement>(".story-card").forEach((card, index) => {
      gsap.set(card, { opacity: index === 0 ? 1 : 0.58, y: index === 0 ? 0 : 32 });
      triggers.push(
        ScrollTrigger.create({
          trigger: card,
          start: "top 58%",
          end: "bottom 42%",
          onEnter: () => {
            activeChapter = index;
            gsap.to(card, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out" });
          },
          onEnterBack: () => {
            activeChapter = index;
            gsap.to(card, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" });
          },
          onLeave: () => gsap.to(card, { opacity: 0.55, y: -18, duration: 0.35, ease: "power2.out" }),
          onLeaveBack: () => gsap.to(card, { opacity: 0.55, y: 22, duration: 0.35, ease: "power2.out" })
        })
      );
    });

    motionCleanup = () => triggers.forEach((trigger) => trigger.kill());
  }

  function topLayerLabel(layer: LayerStat): string {
    return `${layer.label} / ${formatArea(layer.areaM2)}`;
  }
</script>

{#if !model}
  <Loader onModel={handleModel} />
{:else}
  <main class="atlas-shell">
    <CanvasStage
      {model}
      {selectedLayer}
      {selectedMacro}
      {exploreMode}
      on:layerselect={(event) => selectLayer(event.detail)}
    />

    <header class="atlas-topbar">
      <button class="brand-lockup" type="button" on:click={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <span>SBM BOM</span>
        <strong>Mineral Atlas</strong>
      </button>
      <div class="topbar-readout" aria-label="Loaded model summary">
        <span>{formatNumber(model.document.faceCount)} faces</span>
        <span>{model.layers.length} layers</span>
        <span>{formatArea(model.document.totalAreaM2)}</span>
      </div>
      <div class="topbar-actions">
        <button type="button" class:active={exploreMode} on:click={() => (exploreMode = !exploreMode)}>
          {exploreMode ? "Lock camera" : "Orbit camera"}
        </button>
        <button type="button" on:click={() => (model = null)}>Change JSON</button>
      </div>
    </header>

    <aside class="chapter-index" aria-label="Section progress">
      {#each ["Ingest", "Mass", "Grammar", "Ledger", "Evidence", "Explore"] as item, index}
        <span class:active={activeChapter === index}>{String(index + 1).padStart(2, "0")} {item}</span>
      {/each}
    </aside>

    <section id="story-scroll" class="story-scroll">
      <article class="story-card story-card--hero">
        <p class="mono-label">Loaded source / {model.sourceName}</p>
        <h1>Mineral Atlas converts BOM JSON into a navigable 3D evidence map.</h1>
        <p>
          Dark editorial system, precise data surfaces, and scroll-scrubbed Three.js
          model. Same source model. New visual DNA.
        </p>
        <div class="metric-row">
          <span><strong>{formatNumber(model.document.faceCount)}</strong> recursive faces</span>
          <span><strong>{formatNumber(model.document.groupCount)}</strong> groups</span>
          <span><strong>{model.document.maxDepth}</strong> max depth</span>
        </div>
      </article>

      <article class="story-card story-card--right">
        <p class="mono-label">Mass read</p>
        <h2>The building sits as object, not backdrop.</h2>
        <p>
          First viewport gives the model space. Typography no longer collides with
          roof geometry. Labels remain data-led, not decorative stickers.
        </p>
        <div class="data-stack">
          {#each dominantLayers.slice(0, 3) as layer (layer.key)}
            <button type="button" on:click={() => selectLayer(layer.key)} class:active={selectedLayer === layer.key}>
              <span style={`--dot:${layer.color}`}></span>
              {topLayerLabel(layer)}
            </button>
          {/each}
        </div>
      </article>

      <article class="story-card">
        <p class="mono-label">Layer grammar</p>
        <h2>Scroll separates construction systems by macro group.</h2>
        <p>
          GSAP scrub drives exploded offsets, camera rotation, focus opacity, and
          section reveal. Three.js stays useful where spatial reading matters.
        </p>
        <div class="macro-list">
          {#each model.macros as macro (macro.key)}
            <button type="button" on:click={() => selectMacro(macro.key)} class:active={selectedMacro === macro.key}>
              <i style={`--macro:${macro.color}`}></i>
              <span>{MACRO_LABELS[macro.key]}</span>
              <strong>{formatArea(macro.areaM2)}</strong>
            </button>
          {/each}
        </div>
      </article>

      <article class="story-card story-card--wide">
        <LayerLedger
          layers={model.layers}
          macros={model.macros}
          {selectedLayer}
          {selectedMacro}
          onLayerSelect={selectLayer}
          onMacroSelect={selectMacro}
        />
      </article>

      <article class="story-card story-card--right">
        <p class="mono-label">Document evidence</p>
        <h2>JSON metadata becomes visible interface, not hidden plumbing.</h2>
        <div class="evidence-grid">
          <span><em>schema</em><strong>{model.document.schemaVersion || "n/a"}</strong></span>
          <span><em>level</em><strong>{model.document.exportLevel || "n/a"}</strong></span>
          <span><em>exported</em><strong>{model.document.exportedAtPretty || "n/a"}</strong></span>
          <span><em>top entities</em><strong>{model.document.topLevelEntityCount}</strong></span>
          <span><em>components</em><strong>{formatNumber(model.document.componentInstanceCount)}</strong></span>
          <span><em>area</em><strong>{formatArea(model.document.totalAreaM2)}</strong></span>
        </div>
        <div class="histogram">
          {#each histogram as [label, count]}
            <span>{label}<strong>{count}</strong></span>
          {/each}
        </div>
      </article>

      <article class="story-card story-card--final">
        <p class="mono-label">Explore mode</p>
        <h2>End state gives control back.</h2>
        <p>
          Click model or ledger rows to isolate layers. Toggle orbit for manual
          inspection. 3D pauses being decoration and becomes an instrument.
        </p>
        <div class="selected-layer">
          {#if selectedLayerInfo}
            <span style={`--layer:${selectedLayerInfo.color}`}></span>
            <div>
              <strong>{selectedLayerInfo.label}</strong>
              <em>
                {formatArea(selectedLayerInfo.areaM2)} / {formatNumber(selectedLayerInfo.meshCount)} faces /
                {selectedLayerInfo.dominantMaterial ?? selectedLayerInfo.dominantComponent ?? "mixed material"}
              </em>
            </div>
          {:else}
            <strong>No layer selected</strong>
          {/if}
        </div>
      </article>
    </section>
  </main>
{/if}
