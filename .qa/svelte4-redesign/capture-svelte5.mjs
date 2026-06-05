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

await page.goto("http://127.0.0.1:5175/", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(outDir, "svelte5-loader.png"), fullPage: false });
await page.getByRole("button", { name: "Load 3D JSON" }).click();
await page.waitForFunction(() => document.body.innerText.includes("Full structure first"), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(outDir, "svelte5-hero.png"), fullPage: false });

const beatCount = await page.locator(".film-beat").count();
for (let i = 1; i < beatCount - 1; i += 1) {
  await page.locator(".film-beat").nth(i).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(outDir, `svelte5-beat-${i}.png`), fullPage: false });
}

await page.getByRole("button", { name: /Orbit camera|Lock camera/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(outDir, "svelte5-orbit.png"), fullPage: false });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:5175/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Load 3D JSON" }).click();
await page.waitForFunction(() => document.body.innerText.includes("Full structure first"), null, { timeout: 60000 });
await page.waitForTimeout(2200);
await page.screenshot({ path: path.join(outDir, "svelte5-mobile.png"), fullPage: false });

console.log(JSON.stringify({ logs }, null, 2));
await browser.close();
