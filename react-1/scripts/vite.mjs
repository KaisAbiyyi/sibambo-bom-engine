import react from "@vitejs/plugin-react";
import { build, createServer, preview } from "vite";

const command = process.argv[2] ?? "dev";

const config = {
  configFile: false,
  root: process.cwd(),
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
};

if (command === "build") {
  await build(config);
} else if (command === "preview") {
  const server = await preview(config);
  server.printUrls();
} else {
  const server = await createServer(config);
  await server.listen();
  server.printUrls();
}
