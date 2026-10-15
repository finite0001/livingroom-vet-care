import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Synthetic test labels only. This is not an export or a practice label.
export function barcodeVideoFixture(directory: string, ean13: string): string {
  assert.match(ean13, /^0[0-9]{12}$/);
  const left = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const bits = "00000000000" + "101" + Array.from(ean13.slice(1, 7), (digit) => left[Number(digit)]).join("") + "01010" +
    Array.from(ean13.slice(7), (digit) => Array.from(left[Number(digit)], (bit) => bit === "0" ? "1" : "0").join("")).join("") + "101" + "00000000000";
  const width = 640, height = 480, image = Buffer.alloc(width * height * 3 / 2, 128);
  image.fill(235, 0, width * height);
  for (let y = 100; y < 380; y++) for (let x = 0; x < bits.length * 3; x++) if (bits[Math.floor(x / 3)] === "1") image[y * width + 140 + x] = 16;
  const filename = join(directory, "synthetic-barcode-" + randomUUID() + ".y4m");
  writeFileSync(filename, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F5:1 Ip A1:1 C420jpeg\n`),
    ...Array.from({ length: 8 }, () => Buffer.concat([Buffer.from("FRAME\n"), image]))]), { mode: 0o600, flag: "wx" });
  return filename;
}
