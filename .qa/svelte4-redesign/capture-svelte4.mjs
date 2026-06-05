import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/kaisa/AppData/Roaming/npm/node_modules/playwright");

const outDir = "D:/projects/sibambo-bom-engine/.qa/svelte4-redesign";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}`));

await page.goto("http://127.0.0.1:5174/", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(outDir, "svelte4-new-loader.png"), fullPage: false });
await page.getByRole("button", { name: "Load 3D JSON" }).click();
await page.waitForFunction(() => document.body.innerText.includes("recursive faces"), null, { timeout: 60000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(outDir, "svelte4-new-loaded-top.png"), fullPage: false });
await page.mouse.wheel(0, 2600);
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(outDir, "svelte4-new-mid-scroll.png"), fullPage: false });
await page.getByRole("button", { name: /Orbit camera|Lock camera/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(outDir, "svelte4-new-explore.png"), fullPage: false });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:5174/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Load 3D JSON" }).click();
await page.waitForFunction(() => document.body.innerText.includes("recursive faces"), null, { timeout: 60000 });
await page.waitForTimeout(2400);
await page.screenshot({ path: path.join(outDir, "svelte4-new-mobile.png"), fullPage: false });

const canvasPixels = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return { canvas: false };
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return { canvas: true, webgl: false };
  let lit = 0;
  const pixel = new Uint8Array(4);
  for (let y = 0.18; y <= 0.82; y += 0.08) {
    for (let x = 0.18; x <= 0.82; x += 0.08) {
      gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[3] > 0 || pixel[0] + pixel[1] + pixel[2] > 0) lit += 1;
    }
  }
  return { canvas: true, webgl: true, litSamples: lit };
});

console.log(JSON.stringify({ logs, canvasPixels }, null, 2));
await browser.close();
