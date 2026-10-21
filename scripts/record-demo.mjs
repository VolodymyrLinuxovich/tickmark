// Records the demo walkthrough as a video with a visible cursor.
// Start the app first (npm run build && npx next start -p 3790), then:
//   node scripts/record-demo.mjs http://localhost:3790 demo-out
// Writes demo-out/tickmark-demo.webm and demo-out/chapters.json (timestamps for narration).
// Not part of the app. It drives the sample data flow end to end, so it needs no Ramp credentials.

import { chromium } from "playwright-core";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3790";
const out = path.resolve(process.argv[3] ?? "demo-out");
mkdirSync(out, { recursive: true });

const size = { width: 1440, height: 900 };
// Uses the installed Chrome, since playwright-core ships no browser of its own.
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
/** Records a chapter title at the current video time, in seconds. */
const mark = (title) => chapters.push({ at: ((Date.now() - t0) / 1000).toFixed(1), title });
const wait = (ms) => page.waitForTimeout(ms);
let mouse = { x: size.width / 2, y: size.height / 2 };

/** Glides the mouse to the center of an element so viewers can follow it. */
async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(target.x, target.y, { steps: 25 });
  mouse = target;
  await wait(250);
}
/** Moves to an element, clicks it, then holds so the result stays on screen. */
async function click(locator, pause = 900) {
  await moveTo(locator);
  await page.mouse.down();
  await page.mouse.up();
  await wait(pause);
}
/** Smooth wheel scroll, since a single jump is hard to follow on video. */
async function scrollBy(dy, steps = 20) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await wait(30);
  }
  await wait(500);
}

await page.goto(base);
await page.mouse.move(mouse.x, mouse.y);
mark("Intro");
await wait(4500);
mark("The problem");
await click(page.getByRole("link", { name: "Problem", exact: true }), 4500);
mark("Our solution");
await click(page.getByRole("link", { name: "Solution", exact: true }), 4500);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await wait(1200);

mark("Try the sample audit");
await click(page.getByRole("link", { name: "Try it with a sample audit" }), 1200);
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
await page.getByText("Planted problems found", { exact: true }).waitFor();
await wait(4000);
await scrollBy(350);
await wait(4000);
mark("End");

// The video file is only complete after the context closes; then it gets a stable name.
const video = page.video();
await context.close();
await browser.close();
renameSync(await video.path(), path.join(out, "tickmark-demo.webm"));
writeFileSync(path.join(out, "chapters.json"), JSON.stringify(chapters, null, 2));
console.log(chapters.map((c) => `${c.at.padStart(6)}s  ${c.title}`).join("\n"));
