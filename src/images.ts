import type { ImageSettings } from "./model";
export const IMAGE_SIZES = [640, 960, 1600, 1920, 2560, 3840, 7680] as const;
export function normaliseImageSettings(settings: ImageSettings): ImageSettings {
  return {
    enabled: settings.enabled,
    maxEdge: IMAGE_SIZES.find((size) => size === settings.maxEdge) ?? 1600,
    quality: Number.isFinite(settings.quality)
      ? Math.min(0.95, Math.max(0.6, Math.round(settings.quality * 100) / 100))
      : 0.8,
  };
}
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export function imageType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new Error(
    "Use a JPEG, PNG or WebP image. Convert HEIC, GIF and other attachments before publishing.",
  );
}
export function dimensions(
  bytes: Uint8Array,
  mime = imageType(bytes),
): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (mime === "image/png" && bytes.length >= 24) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const size = view.getUint16(offset + 2);
      if (size < 2) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      offset += size + 2;
    }
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const kind = new TextDecoder().decode(bytes.slice(12, 16));
    if (kind === "VP8X") {
      if ((bytes[20]! & 2) !== 0)
        throw new Error(
          "Animated WebP is not supported. Choose a still image.",
        );
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    }
    if (kind === "VP8 ") {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    }
    if (kind === "VP8L") {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  if (!width || !height)
    throw new Error(
      "Could not read image dimensions. Re-export the image before publishing.",
    );
  return { width, height };
}
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
export async function optimiseImage(
  buffer: ArrayBuffer,
  settings: ImageSettings,
): Promise<{ bytes: ArrayBuffer; mime: string }> {
  if (buffer.byteLength > MAX_IMAGE_BYTES)
    throw new Error(
      "Image exceeds 12 MiB. Resize the source before publishing.",
    );
  const mime = imageType(new Uint8Array(buffer));
  const size = dimensions(new Uint8Array(buffer), mime);
  if (size.width * size.height > MAX_IMAGE_PIXELS)
    throw new Error(
      "Image exceeds the 40 megapixel image limit. Resize it before publishing.",
    );
  if (!settings.enabled) return { bytes: buffer, mime };
  if (
    !Number.isFinite(settings.maxEdge) ||
    !IMAGE_SIZES.some((size) => size === settings.maxEdge) ||
    settings.quality < 0.6 ||
    settings.quality > 0.95 ||
    !Number.isFinite(settings.quality)
  )
    throw new Error("Check global image optimisation settings.");
  const source = URL.createObjectURL(new Blob([buffer], { type: mime }));
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    image.src = source;
    await image.decode();
    const target = scaledDimensions(
      image.naturalWidth,
      image.naturalHeight,
      settings.maxEdge,
    );
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "Image optimisation is unavailable on this device. Disable it in global settings to upload the original.",
      );
    context.drawImage(image, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Could not compress this image.")),
        "image/webp",
        settings.quality,
      ),
    );
    // Some browsers fall back to PNG. Retain the original if re-encoding only increased size and no resize was needed.
    if (
      blob.size >= buffer.byteLength &&
      target.width === image.naturalWidth &&
      target.height === image.naturalHeight
    )
      return { bytes: buffer, mime };
    if (blob.size > MAX_IMAGE_BYTES)
      throw new Error(
        "Optimised image exceeds the upload limit. Resize it further.",
      );
    return { bytes: await blob.arrayBuffer(), mime: blob.type };
  } finally {
    URL.revokeObjectURL(source);
    image.src = "";
    canvas.width = 0;
    canvas.height = 0;
  }
}
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export function fromBase64(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
}
export function mediaPath(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !/^\/__media\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.webp$/i.test(
      parsed.pathname,
    )
  )
    throw new Error("OnceMarked returned an invalid image address.");
  return parsed.pathname;
}
