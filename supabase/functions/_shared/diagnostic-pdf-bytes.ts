import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export async function diagnosticPdfDigest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function verifiedDiagnosticPdfResponse(
  response: Response,
  length: number,
  sha: string,
) {
  if (
    response.status !== 200 ||
    response.redirected ||
    !response.body ||
    response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
      "application/pdf" ||
    (response.headers.has("Content-Encoding") &&
      response.headers.get("Content-Encoding") !== "identity")
  )
    throw new Error("Private PDF unavailable");
  const advertised = response.headers.get("Content-Length");
  if (
    advertised !== null &&
    (!/^\d+$/.test(advertised) || Number(advertised) !== length)
  )
    throw new Error("PDF length differs");
  z.number().int().min(1).max(3145728).parse(length);
  hash.parse(sha);
  const reader = response.body.getReader();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 10000);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > length || size > 3145728) {
        await reader.cancel();
        throw new Error("PDF exceeds bound");
      }
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  if (timedOut || size !== length) throw new Error("PDF length differs");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  if ((await diagnosticPdfDigest(bytes)) !== sha)
    throw new Error("PDF bytes differ");
  return bytes;
}
