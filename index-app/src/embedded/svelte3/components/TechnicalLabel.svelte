<script lang="ts">
  export let label: string;
  export let value: string | undefined = undefined;
  export let className = "";
</script>

<span class={`technical-label ${className}`.trim()}>
  <span>{label}</span>
  {#if value}
    <strong>{value}</strong>
  {/if}
</span>
