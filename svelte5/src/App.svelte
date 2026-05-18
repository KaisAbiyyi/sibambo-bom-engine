<script lang="ts">
  import { tick } from "svelte";
  import { gsap } from "gsap";
  import { ScrollTrigger } from "gsap/ScrollTrigger";
  import CanvasStage from "./components/CanvasStage.svelte";
  import Loader from "./components/Loader.svelte";
  import { FOCUS_BEATS } from "./data/beats";
  import { MACRO_COLORS, MACRO_LABELS, type MacroKey } from "./data/layers";
  import { formatArea, formatNumber } from "./lib/model";
  import type { ParsedModel } from "./types";

  let model: ParsedModel | null = null;
  let selectedLayer = "";
  let selectedMacro: MacroKey | "" = "";
  let exploreMode = false;
  let activeBeat = 0;
  let motionCleanup: (() => void) | null = null;

  gsap.registerPlugin(ScrollTrigger);

  $: beat = FOCUS_BEATS[activeBeat] ?? FOCUS_BEATS[0];
  $: activeLayer = model?.layers.find((layer) => layer.key === (selectedLayer || beat.layerKey)) ?? null;
  $: activeMacro = selectedMacro || beat.macro;
  $: focusColor = activeLayer?.color ?? (activeMacro ? MACRO_COLORS[activeMacro] : "#d18a52");
  $: activeMacroStats = activeMacro ? model?.macros.find((macro) => macro.key === activeMacro) ?? null : null;
  $: dominantLayers = model ? [...model.layers].sort((a, b) => b.areaM2 - a.areaM2).slice(0, 6) : [];

  function handleModel(next: ParsedModel): void {
    model = next;
    selectedLayer = "";
    selectedMacro = "";
    exploreMode = false;
    activeBeat = 0;
    void tick().then(setupStoryMotion);
  }

  function selectLayer(key: string): void {
    selectedLayer = selectedLayer === key ? "" : key;
    const layer = model?.layers.find((item) => item.key === key);
    selectedMacro = layer?.macro ?? "";
  }

  function selectMacro(key: MacroKey | ""): void {
    selectedMacro = selectedMacro === key ? "" : key;
    if (selectedMacro) {
      selectedLayer = model?.layers.find((layer) => layer.macro === selectedMacro)?.key ?? "";
    }
  }

  function setupStoryMotion(): void {
    motionCleanup?.();
    const triggers: ScrollTrigger[] = [];
    document.querySelectorAll<HTMLElement>(".film-beat").forEach((card, index) => {
      gsap.set(card, { opacity: index === 0 ? 1 : 0.34, y: index === 0 ? 0 : 44 });
      triggers.push(
        ScrollTrigger.create({
          trigger: card,
          start: "top 62%",
          end: "bottom 40%",
          onEnter: () => {
            activeBeat = index;
            gsap.to(card, { opacity: 1, y: 0, duration: 0.7, ease: "power4.out" });
          },
          onEnterBack: () => {
            activeBeat = index;
            gsap.to(card, { opacity: 1, y: 0, duration: 0.55, ease: "power4.out" });
          },
          onLeave: () => gsap.to(card, { opacity: 0.34, y: -34, duration: 0.45, ease: "power2.out" }),
          onLeaveBack: () => gsap.to(card, { opacity: 0.34, y: 34, duration: 0.45, ease: "power2.out" })
        })
      );
    });
    motionCleanup = () => triggers.forEach((trigger) => trigger.kill());
  }
</script>

{#if !model}
  <Loader onModel={handleModel} />
{:else}
  <main class="ritual-shell" style={`--focus:${focusColor}`}>
    <CanvasStage
      {model}
      {selectedLayer}
      {selectedMacro}
      {exploreMode}
      on:layerselect={(event) => selectLayer(event.detail)}
      on:activebeat={(event) => (activeBeat = event.detail)}
    />

    <header class="ritual-topbar">
      <button class="ritual-brand" type="button" on:click={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <span>SBM BOM</span>
        <strong>Component Cuts</strong>
      </button>
      <div class="ritual-pulse" aria-label="Active focus">
        <i></i>
        <span>{beat.eyebrow}</span>
        <strong>{activeMacro ? MACRO_LABELS[activeMacro] : "Full model"}</strong>
      </div>
      <div class="ritual-actions">
        <button type="button" class:active={exploreMode} on:click={() => (exploreMode = !exploreMode)}>
          {exploreMode ? "Lock camera" : "Orbit camera"}
        </button>
        <button type="button" on:click={() => (model = null)}>Change JSON</button>
      </div>
    </header>

    <aside class="shot-rail" aria-label="Camera route">
      {#each FOCUS_BEATS as item, index (item.id)}
        <button
          type="button"
          class:active={index === activeBeat}
          style={`--beat-color:${item.macro ? MACRO_COLORS[item.macro] : "#d18a52"}`}
          on:click={() => {
            activeBeat = index;
            document.querySelectorAll(".film-beat")[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          <span>{String(index).padStart(2, "0")}</span>
          <strong>{item.camera}</strong>
        </button>
      {/each}
    </aside>

    <section class="live-dossier" aria-label="Focused JSON evidence">
      <p>locked target</p>
      {#if activeLayer}
        <h2>{activeLayer.label}</h2>
        <div>
          <span>{formatArea(activeLayer.areaM2)}</span>
          <span>{formatNumber(activeLayer.meshCount)} faces</span>
          <span>{activeLayer.dominantComponent ?? activeLayer.dominantMaterial ?? "mixed"}</span>
        </div>
      {:else if activeMacroStats}
        <h2>{activeMacroStats.label}</h2>
        <div>
          <span>{formatArea(activeMacroStats.areaM2)}</span>
          <span>{formatNumber(activeMacroStats.meshCount)} faces</span>
          <span>{activeMacroStats.layerCount} layers</span>
        </div>
      {:else}
        <h2>Full model</h2>
        <div>
          <span>{formatNumber(model.document.faceCount)} faces</span>
          <span>{model.layers.length} layers</span>
          <span>{formatArea(model.document.totalAreaM2)}</span>
        </div>
      {/if}
    </section>

    <section id="story-scroll" class="film-scroll">
      {#each FOCUS_BEATS as item, index (item.id)}
        <article
          class="film-beat"
          class:film-beat--wide={index === 0 || index === FOCUS_BEATS.length - 1}
          style={`--beat:${item.macro ? MACRO_COLORS[item.macro] : "#d18a52"}`}
        >
          <p class="mono-label">{item.eyebrow}</p>
          <h1>{item.title}</h1>
          <p>{item.body}</p>

          {#if item.id === "origin"}
            <div class="origin-stats">
              <span><strong>{formatNumber(model.document.faceCount)}</strong> faces</span>
              <span><strong>{model.layers.length}</strong> layers</span>
              <span><strong>{formatArea(model.document.totalAreaM2)}</strong> surface</span>
            </div>
          {:else if item.id === "release"}
            <div class="component-chips">
              {#each dominantLayers as layer (layer.key)}
                <button
                  type="button"
                  class:active={selectedLayer === layer.key}
                  style={`--chip:${layer.color}`}
                  on:click={() => selectLayer(layer.key)}
                >
                  {layer.label}
                  <span>{formatArea(layer.areaM2)}</span>
                </button>
              {/each}
            </div>
          {:else if item.macro}
            {@const macro = model.macros.find((entry) => entry.key === item.macro)}
            <div class="beat-evidence">
              <button type="button" on:click={() => selectMacro(item.macro)}>
                <span>system area</span>
                <strong>{macro ? formatArea(macro.areaM2) : "n/a"}</strong>
              </button>
              <button type="button" on:click={() => item.layerKey && selectLayer(item.layerKey)}>
                <span>primary layer</span>
                <strong>{model.layers.find((layer) => layer.key === item.layerKey)?.label ?? "mixed"}</strong>
              </button>
            </div>
          {/if}
        </article>
      {/each}
    </section>
  </main>
{/if}
