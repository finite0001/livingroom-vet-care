import { prepareZXingModule, readBarcodes, ZXING_WASM_SHA256, ZXING_WASM_VERSION } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { decoderFormats, decoderFrameSchema, decodedSymbolSchema, type DecoderReply } from "./decoder-contract.ts";

const EXPECTED_WASM_BYTES = 966895;
const EXPECTED_WASM_SHA256 = "aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931";
let ready: Promise<unknown> | null = null;
let busy = false;

async function initialize(): Promise<unknown> {
  if (ZXING_WASM_VERSION !== "3.1.5" || ZXING_WASM_SHA256 !== EXPECTED_WASM_SHA256) throw new Error("Decoder artifact differs");
  const url = new URL(wasmUrl, self.location.href);
  if (url.origin !== self.location.origin) throw new Error("Local decoder artifact required");
  const response = await fetch(url, { credentials: "omit", redirect: "error", cache: "force-cache" });
  if (!response.ok || !response.body) throw new Error("Decoder artifact unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > EXPECTED_WASM_BYTES) throw new Error("Decoder artifact exceeds reviewed size");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (size !== EXPECTED_WASM_BYTES) throw new Error("Decoder artifact size differs");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== EXPECTED_WASM_SHA256) throw new Error("Decoder artifact hash differs");
  return prepareZXingModule({ overrides: { wasmBinary: bytes, locateFile: () => url.href }, fireImmediately: true });
}

self.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const frame = decoderFrameSchema.safeParse(event.data);
  if (busy || !frame.success) {
    const reply: DecoderReply = { outcome: "failed", sequence: frame.success ? frame.data.sequence : 0 };
    self.postMessage(reply); return;
  }
  busy = true;
  try {
    await (ready ??= initialize());
    const image = new ImageData(frame.data.data, frame.data.width, frame.data.height);
    const result = await readBarcodes(image, { formats: [...decoderFormats], maxNumberOfSymbols: 4, tryHarder: true });
    const symbols = result.map((symbol) => decodedSymbolSchema.parse({ text: symbol.text, bytes: Array.from(symbol.bytes), format: symbol.format, symbologyIdentifier: symbol.symbologyIdentifier }));
    const reply: DecoderReply = { outcome: "decoded", sequence: frame.data.sequence, symbols };
    self.postMessage(reply);
  } catch {
    const reply: DecoderReply = { outcome: "failed", sequence: frame.data.sequence };
    self.postMessage(reply);
  } finally { busy = false; }
});
