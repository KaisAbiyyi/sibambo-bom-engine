<script lang="ts">
  export let orientation: "horizontal" | "vertical" = "vertical";
  export let label = "section datum";
  export let ticks = 7;
</script>

<div class={`measurement-rail measurement-rail--${orientation}`} data-parallax data-depth="0.18">
  <span>{label}</span>
  {#each Array.from({ length: ticks }) as _, index (index)}
    <i></i>
  {/each}
</div>
