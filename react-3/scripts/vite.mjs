import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const child = spawn("vite", args, {
  shell: true,
  stdio: "inherit"
});

child.on("exit", (code) => process.exit(code ?? 0));
