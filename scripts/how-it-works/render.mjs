// Renders scene.html frame by frame and writes PNG frames for ffmpeg.
//   node scripts/how-it-works/render.mjs <outDir> [fps] [onlyTimes,comma,separated]
// Then make the README GIF with ffmpeg: fps=15, scale=960, palettegen + paletteuse, to docs/how-it-works.gif.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? "hiw-frames");
const fps = Number(process.argv[3] ?? 24);
const only = process.argv[4]?.split(",").map(Number);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
await page.goto("file://" + path.join(here, "scene.html"));
const times = only ?? Array.from({ length: 30 * fps }, (_, i) => i / fps);
for (let i = 0; i < times.length; i++) {
  await page.evaluate((t) => window.render(t), times[i]);
  await page.screenshot({ path: path.join(out, `f${String(i).padStart(4, "0")}.png`) });
}
await browser.close();
console.log(`${times.length} frames in ${out}`);
