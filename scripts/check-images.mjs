import { build } from "esbuild";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const bundle = await build({
  entryPoints: ["src/images.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "omImages",
  write: false,
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("about:blank");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext("2d");
    context.fillStyle = "#4580b0";
    context.fillRect(50, 50, 3900, 2900);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const original = await blob.arrayBuffer();
    const copy = original.slice(0);
    const compressed = await omImages.optimiseImage(original, {
      enabled: true,
      maxEdge: 1600,
      quality: 0.8,
    });
    const size = omImages.dimensions(new Uint8Array(compressed.bytes));
    const bitmap = await createImageBitmap(
      new Blob([compressed.bytes], { type: compressed.mime }),
    );
    const output = document.createElement("canvas");
    output.width = bitmap.width;
    output.height = bitmap.height;
    const ctx = output.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
    bitmap.close();
    const unchanged = await omImages.optimiseImage(original, {
      enabled: false,
      maxEdge: 1600,
      quality: 0.8,
    });
    const oversized = original.slice(0);
    const view = new DataView(oversized);
    view.setUint32(16, 12000);
    view.setUint32(20, 8000);
    let oversizedRejected = false;
    try {
      await omImages.optimiseImage(oversized, {
        enabled: true,
        maxEdge: 1600,
        quality: 0.8,
      });
    } catch {
      oversizedRejected = true;
    }
    return {
      size,
      alpha,
      originalBytes: original.byteLength,
      compressedBytes: compressed.bytes.byteLength,
      originalPreserved: new Uint8Array(copy).every(
        (b, i) => new Uint8Array(original)[i] === b,
      ),
      disabledPreserved: unchanged.bytes === original,
      oversizedRejected,
    };
  });
  assert.deepEqual(result.size, { width: 1600, height: 1200 });
  assert.equal(result.alpha, 0);
  assert.equal(result.originalPreserved, true);
  assert.equal(result.disabledPreserved, true);
  assert.equal(result.oversizedRejected, true);
  assert.ok(result.compressedBytes < result.originalBytes);
  console.log("Browser image checks passed:", JSON.stringify(result));
} finally {
  await browser.close();
}
