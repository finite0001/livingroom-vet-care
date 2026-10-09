export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export interface ImageDimensions {
  width: number;
  height: number;
}

/** Container/dimension checks; not a malware scan or a full image decoder. */
export function photoDimensions(
  bytes: Uint8Array,
  mime: string,
): ImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = (): never => {
    throw new Error("Choose a complete JPEG or PNG image.");
  };
  if (mime === "image/png") {
    if (
      bytes.length < 45 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
    ) invalid();
    let at = 8, dimensions: ImageDimensions | null = null, data = false;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at), end = at + 12 + length;
      if (end > bytes.length) invalid();
      const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (at === 8 && (kind !== "IHDR" || length !== 13)) invalid();
      let crc = 0xffffffff;
      for (let i = at + 4; i < at + 8 + length; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++) {
          crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
      }
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(at + 8 + length)) {
        invalid();
      }
      if (kind === "IHDR") {
        if (dimensions) invalid();
        dimensions = {
          width: view.getUint32(at + 8),
          height: view.getUint32(at + 12),
        };
      }
      if (kind === "IDAT") data = true;
      if (kind === "IEND") {
        if (length !== 0 || end !== bytes.length || !data || !dimensions) {
          invalid();
        }
        return dimensions ?? invalid();
      }
      at = end;
    }
    return invalid();
  }
  if (mime === "image/jpeg") {
    if (
      bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 ||
      bytes.at(-2) !== 255 || bytes.at(-1) !== 217
    ) invalid();
    let at = 2;
    while (at + 4 < bytes.length) {
      if (bytes[at++] !== 255) invalid();
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) invalid();
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) invalid();
        return {
          height: view.getUint16(at + 3),
          width: view.getUint16(at + 5),
        };
      }
      at += length;
    }
  }
  return invalid();
}

export async function photoDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Decode the bounded, noninterlaced 8-bit RGB/RGBA scanlines emitted by canvas. */
export async function verifyNormalizedPhoto(
  bytes: Uint8Array,
): Promise<ImageDimensions> {
  const dimensions = photoDimensions(bytes, "image/png");
  const { width, height } = dimensions;
  if (
    bytes.length > MAX_PHOTO_BYTES || width < 1 || height < 1 || width > 1024 ||
    height > 1024
  ) {
    throw new Error("Normalized photo dimensions exceed bounds");
  }
  if (
    bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[26] !== 0 ||
    bytes[27] !== 0 || bytes[28] !== 0
  ) {
    throw new Error("Expected normalized RGB or RGBA pixels");
  }
  const chunks: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (
      /^[A-Z]/.test(name) && !["IHDR", "IDAT", "IEND", "PLTE"].includes(name)
    ) {
      throw new Error("Unknown critical PNG chunk");
    }
    if (name === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  }).pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const stride = width * (bytes[25] === 6 ? 4 : 3) + 1;
  const expected = stride * height;
  let decoded = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (decoded + value.length > expected) {
        throw new Error("Extra image pixels");
      }
      for (
        let offset = (stride - decoded % stride) % stride;
        offset < value.length;
        offset += stride
      ) {
        if (value[offset] > 4) throw new Error("Invalid PNG filter");
      }
      decoded += value.length;
    }
    if (decoded !== expected) throw new Error("Incomplete image pixels");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return dimensions;
}
