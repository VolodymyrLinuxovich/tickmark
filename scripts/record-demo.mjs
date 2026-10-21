// Records the demo walkthrough as a video with a visible cursor.
// Start the app first (npm run build && npx next start -p 3790), then:
//   node scripts/record-demo.mjs http://localhost:3790 demo-out
// Writes demo-out/tickmark-demo.webm and demo-out/chapters.json (timestamps for narration).

import { chromium } from "playwright-core";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3790";
const out = path.resolve(process.argv[3] ?? "demo-out");
mkdirSync(out, { recursive: true });

const size = { width: 1440, height: 900 };
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: size, recordVideo: { dir: out, size }, acceptDownloads: true, colorScheme: "light" });

// A visible cursor and click ring, since recorded video has no pointer.
await context.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;z-index:99999;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(23,113,74,.35);border:2px solid #17714a;pointer-events:none;transition:transform .12s";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => (c.style.transform = "scale(.7)"), true);
    addEventListener("mouseup", () => (c.style.transform = "scale(1)"), true);
  });
});

const page = await context.newPage();
const t0 = Date.now();
const chapters = [];
const mark = (title) => chapters.push({ at: ((Date.now() - t0) / 1000).toFixed(1), title });
const wait = (ms) => page.waitForTimeout(ms);
let mouse = { x: size.width / 2, y: size.height / 2 };

async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(target.x, target.y, { steps: 25 });
  mouse = target;
  await wait(250);
}
async function click(locator, pause = 900) {
  await moveTo(locator);
  await page.mouse.down();
  await page.mouse.up();
  await wait(pause);
}
async function scrollBy(dy, steps = 20) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await wait(30);
  }
  await wait(500);
}

await page.goto(`${base}/app`);
await page.mouse.move(mouse.x, mouse.y);
mark("Problem: the auditor's request list");
await wait(5000);

mark("Drop in the request list");
await click(page.getByRole("button", { name: "Try the sample list" }), 1200);
await page.getByRole("button", { name: /Pull evidence/ }).waitFor();
mark("Review the plan");
await wait(3500);
await scrollBy(500);
await wait(2500);
await scrollBy(-500);

mark("Pull evidence from Ramp");
await click(page.getByRole("button", { name: /Pull evidence/ }), 300);
await page.getByRole("button", { name: /Download binder/ }).waitFor({ timeout: 30000 });
await wait(3500);

mark("One exception: a split purchase");
const split = page.locator(".finding", { hasText: "Possible split purchase" });
await moveTo(split.locator("b").first());
await wait(3500);
await click(split.locator(".recs .rec").first(), 3500);
await page.keyboard.press("Escape");
await wait(800);
await click(split.getByRole("button", { name: /Draft comment/ }), 3500);
mark("Approve the follow-up");
await click(split.getByRole("button", { name: "Approve and send" }), 2200);

mark("Workpaper evidence with tickmarks");
await click(page.locator(".req-item", { hasText: "PBC-02" }), 1500);
await click(page.getByRole("button", { name: /^Evidence/ }), 1200);
await moveTo(page.locator("tr.flag").first());
await wait(3500);

mark("Download the binder");
const [download] = await Promise.all([page.waitForEvent("download"), click(page.getByRole("button", { name: /Download binder/ }), 1500)]);
await download.saveAs(path.join(out, await download.suggestedFilename()));
await wait(1500);

mark("Accuracy: 8 of 8 planted problems");
await click(page.getByRole("link", { name: "Accuracy" }), 500);
await page.getByText("Planted problems found").waitFor();
await wait(4000);
await scrollBy(350);
await wait(4000);
mark("End");

const video = page.video();
await context.close();
await browser.close();
renameSync(await video.path(), path.join(out, "tickmark-demo.webm"));
writeFileSync(path.join(out, "chapters.json"), JSON.stringify(chapters, null, 2));
console.log(chapters.map((c) => `${c.at.padStart(6)}s  ${c.title}`).join("\n"));
