<script lang="ts">
  import type { LayerKey, ParsedModel } from "../types/model";
  import type { SceneData } from "../types/scene";

  export let scene: SceneData;
  export let model: ParsedModel | null;
  export let hiddenLayerKeys = new Set<LayerKey>();

  $: names = model
    ? Array.from(
        new Set(
          scene.activeLayerKeys.flatMap((layerKey) => {
            if (hiddenLayerKeys.has(layerKey)) return [];
            const layer = model.layerRegistry[layerKey];
            return layer ? layer.meshes.map((mesh) => mesh.materialName || mesh.name) : [];
          })
        )
      )
        .filter(Boolean)
        .slice(0, 5)
    : [];
</script>

{#if names.length}
  <div class="component-index" data-parallax data-depth="0.1">
    <span>Model components</span>
    {#each names as name (name)}
      <em>{name}</em>
    {/each}
  </div>
{/if}
