<script lang="ts">
  import type { LayerKey, ParsedModel } from "../types/model";
  import type { SceneData } from "../types/scene";
  import { formatInteger } from "../lib/format";

  export let scene: SceneData;
  export let model: ParsedModel | null;
  export let compact = false;
  export let hiddenLayerKeys = new Set<LayerKey>();
  export let toggleLayer: (layerKey: LayerKey) => void = () => undefined;

  $: layers = scene.activeLayerKeys
    .map((key) => model?.layerRegistry[key])
    .filter(Boolean)
    .slice(0, compact ? 4 : 8);
</script>

{#if !layers.length}
  <div class="layer-legend layer-legend--empty">
    <span>Load model data</span>
  </div>
{:else}
  <div class={`layer-legend ${compact ? "layer-legend--compact" : ""}`.trim()}>
    {#each layers as layer (layer!.key)}
      {@const isEnabled = !hiddenLayerKeys.has(layer!.key)}
      <button
        type="button"
        class="layer-legend__item"
        role="checkbox"
        aria-checked={isEnabled}
        aria-label={`${layer!.label} in ${scene.title}`}
        style={`--layer-color: ${layer!.color}`}
        onclick={() => toggleLayer(layer!.key)}
      >
        <i></i>
        <span>{layer!.label}</span>
        {#if !compact}
          <em>{formatInteger(layer!.meshCount)} meshes</em>
        {/if}
      </button>
    {/each}
  </div>
{/if}
