/** Keep raw bytes until the action-specific closed decoder verifies them. */
export async function readCountResponseBytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2 * 1024 * 1024 || !response.ok ||
    !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) {
    void response.body?.cancel().catch(() => {});
    throw new Error("The count response is unconfirmed.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The count response is unconfirmed.");
  const bytes = new Uint8Array(limit); let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new Error("The count response is unconfirmed.");
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error("The count response is unconfirmed.");
      if (done) return bytes.slice(0, length);
      if (length + value.byteLength > limit) throw new Error("The count response is unconfirmed.");
      bytes.set(value, length); length += value.byteLength;
    }
  } catch (error) { abort(); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
