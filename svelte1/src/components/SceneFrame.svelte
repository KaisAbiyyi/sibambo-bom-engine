<script lang="ts">
  import type { SceneData } from "../types/scene";

  export let scene: SceneData;
  export let active = false;
</script>

<section
  class={`scene scene--${scene.id} ${active ? "is-active" : ""}`.trim()}
  data-scene-id={scene.id}
  data-content-zone={scene.layout.contentZone}
  data-model-zone={scene.layout.modelZone}
  data-allow-over-model={String(scene.layout.allowTextOverModel)}
  style={`--scene-text-width: ${scene.layout.maxTextWidth}px`}
>
  <slot />
</section>
