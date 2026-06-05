import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/kaisa/AppData/Roaming/npm/node_modules/playwright");

const outDir = "D:/projects/sibambo-bom-engine/.qa/svelte4-redesign";
await mkdir(outDir, { recursive: true });

const targets = [
  { name: "svelte1", url: "http://127.0.0.1:5171/" },
  { name: "svelte2", url: "http://127.0.0.1:5172/" },
  { name: "svelte3", url: "http://127.0.0.1:5173/" }
];

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

for (const target of targets) {
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, `${target.name}-loader.png`), fullPage: true });
  const loadButton = page.locator('button[type="submit"]').first();
  await loadButton.click();
  await page.waitForFunction(() => document.body.innerText.includes("meshes"), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, `${target.name}-loaded-top.png`), fullPage: false });
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, `${target.name}-loaded-scroll.png`), fullPage: false });
}

await browser.close();
console.log(`Captured ${targets.length} baseline apps into ${outDir}`);
