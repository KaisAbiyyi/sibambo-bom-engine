import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/kaisa/AppData/Roaming/npm/node_modules/playwright");

const [name, url] = process.argv.slice(2);
const outDir = "D:/projects/sibambo-bom-engine/.qa/svelte4-redesign";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.locator('button[type="submit"]').first().click({ force: true });
await page.waitForTimeout(90000);
await page.screenshot({ path: path.join(outDir, `${name}-after-90s.png`), fullPage: false });
console.log(await page.locator("body").innerText());
console.log("LOGS");
console.log(logs.join("\n"));
await browser.close();
