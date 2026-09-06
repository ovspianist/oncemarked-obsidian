import { expect, it } from "vitest";
import {
  normaliseImageSettings,
  IMAGE_SIZES,
  dimensions,
  imageType,
  scaledDimensions,
  mediaPath,
  toBase64,
  fromBase64,
} from "../src/images";
it("reads PNG dimensions before allocating a decoder", () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 12000);
  view.setUint32(20, 8000);
  expect(imageType(bytes)).toBe("image/png");
  expect(dimensions(bytes)).toEqual({ width: 12000, height: 8000 });
});
it("does not upscale and preserves aspect ratio", () => {
  expect(scaledDimensions(4000, 3000, 1920)).toEqual({
    width: 1920,
    height: 1440,
  });
  expect(scaledDimensions(100, 200, 1920)).toEqual({ width: 100, height: 200 });
});
it("rejects unsupported and corrupt image headers", () => {
  expect(() => imageType(new TextEncoder().encode("GIF89a"))).toThrow("JPEG");
  expect(() => dimensions(new Uint8Array([255, 216]))).toThrow("dimensions");
});
it("validates media addresses and preserves binary retry payloads", () => {
  const url =
    "https://author.example/__media/12345678-1234-4123-8123-123456789012.webp";
  expect(mediaPath(url)).toBe(new URL(url).pathname);
  expect(() => mediaPath("https://author.example/image.svg")).toThrow();
  const bytes = new Uint8Array([0, 255, 17, 20]).buffer;
  expect(fromBase64(toBase64(bytes))).toEqual(bytes);
});

it("matches OnceMarked image steps and migrates out-of-range saved choices", () => {
  expect(IMAGE_SIZES).toEqual([640, 960, 1600, 1920, 2560, 3840, 7680]);
  expect(
    normaliseImageSettings({ enabled: true, maxEdge: 1280, quality: 0.3 }),
  ).toEqual({ enabled: true, maxEdge: 1600, quality: 0.6 });
  expect(
    normaliseImageSettings({ enabled: true, maxEdge: 7680, quality: 1 }),
  ).toEqual({ enabled: true, maxEdge: 7680, quality: 0.95 });
  expect(
    normaliseImageSettings({ enabled: false, maxEdge: 1920, quality: 0.71 }),
  ).toEqual({ enabled: false, maxEdge: 1920, quality: 0.71 });
});
