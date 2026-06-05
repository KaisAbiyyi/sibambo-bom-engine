<script lang="ts">
  import type { SceneData } from "../types/scene";

  export let scene: SceneData;
  export let index: number;

  $: source =
    scene.specs?.find((spec) => spec.label.includes("meshes") || spec.label === "Meshes")?.value ||
    `${scene.activeLayerKeys.length || "awaiting model"} layers`;
</script>

<aside class="title-block" data-parallax data-depth="0.08">
  <div class="title-block__row">
    <span>AB-{String(index + 1).padStart(2, "0")}</span>
    <span>{scene.category}</span>
  </div>
  <div class="title-block__row">
    <span>Mode</span>
    <span>{scene.displayMode}</span>
  </div>
  <div class="title-block__row">
    <span>Source</span>
    <span>{source}</span>
  </div>
</aside>
