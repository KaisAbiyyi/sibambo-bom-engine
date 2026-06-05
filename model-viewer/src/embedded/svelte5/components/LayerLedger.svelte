<script lang="ts">
  import type { LayerStat, MacroStat } from "../types";
  import { formatArea, formatNumber } from "../lib/model";

  export let layers: LayerStat[];
  export let macros: MacroStat[];
  export let selectedLayer = "";
  export let selectedMacro = "";
  export let onLayerSelect: (key: string) => void;
  export let onMacroSelect: (key: string) => void;

  $: maxArea = Math.max(...layers.map((layer) => layer.areaM2), 1);
</script>

<section class="ledger-block" aria-label="Layer ledger">
  <div class="ledger-heading">
    <p class="mono-label">JSON material ledger</p>
    <h2>Every visible layer comes from parsed BOM entities.</h2>
  </div>

  <div class="macro-strip">
    {#each macros as macro (macro.key)}
      <button
        type="button"
        class:active={selectedMacro === macro.key}
        on:click={() => onMacroSelect(macro.key)}
        style={`--macro-color:${macro.color}`}
      >
        <span>{macro.label}</span>
        <strong>{formatArea(macro.areaM2)}</strong>
        <em>{formatNumber(macro.meshCount)} faces</em>
      </button>
    {/each}
  </div>

  <div class="layer-table">
    {#each layers as layer (layer.key)}
      <button
        type="button"
        class:active={selectedLayer === layer.key}
        class:muted={selectedMacro && layer.macro !== selectedMacro}
        on:click={() => onLayerSelect(layer.key)}
        style={`--layer-color:${layer.color};--bar:${(layer.areaM2 / maxArea) * 100}%`}
      >
        <span class="layer-swatch"></span>
        <span class="layer-name">{layer.label}</span>
        <span class="layer-area">{formatArea(layer.areaM2)}</span>
        <span class="layer-mesh">{formatNumber(layer.meshCount)} faces</span>
        <span class="layer-material">{layer.dominantMaterial ?? layer.dominantComponent ?? "mixed"}</span>
      </button>
    {/each}
  </div>
</section>
