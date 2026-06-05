import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte(), react()],
  server: {
    host: "127.0.0.1",
    port: 5200
  }
});
