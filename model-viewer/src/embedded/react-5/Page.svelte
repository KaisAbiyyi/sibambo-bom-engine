<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import React from "react";
  import { createRoot, type Root } from "react-dom/client";
  import App from "./App";
  import "./styles.css";

  let host: HTMLDivElement;
  let root: Root | null = null;

  onMount(() => {
    root = createRoot(host);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
  });

  onDestroy(() => {
    root?.unmount();
  });
</script>

<div class="react-native-host" bind:this={host}></div>
