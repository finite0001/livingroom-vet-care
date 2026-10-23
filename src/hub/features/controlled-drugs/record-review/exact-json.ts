/** Raw transport decoding. Numeric source evidence never passes through Number. */
export class ExactJsonNumber {
  readonly token: string;
  constructor(token: string) {
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token) || token.length > 1024)
      throw new Error("Invalid exact JSON number");
    this.token = token;
    Object.freeze(this);
  }
  toString(): string { return this.token; }
  [Symbol.toPrimitive](hint: string): string {
    if (hint !== "string") throw new Error("Exact evidence must not be coerced to a JS number");
    return this.token;
  }
  toJSON(): never { throw new Error("Exact evidence must not be reserialized as ordinary JSON"); }
}
export type ExactJson = null | boolean | string | ExactJsonNumber | readonly ExactJson[] | { readonly [key: string]: ExactJson };
export const reviewResponseByteLimit = 2 * 1024 * 1024;

export function validUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Bounds are a client resource ceiling, not a claim that a packet is authorized. */
export function decodeExactJson(raw: Uint8Array): ExactJson {
  if (raw.byteLength === 0 || raw.byteLength > reviewResponseByteLimit) throw new Error("Review response size is invalid");
  // ignoreBOM preserves a BOM, allowing the JSON grammar below to reject it.
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  let offset = 0, nodes = 0;
  const fail = (): never => { throw new Error("Review response is not bounded exact JSON"); };
  function space() { while (/[\x20\t\r\n]/.test(text[offset] ?? "!")) offset++; }
  function string(): string {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '"') {
        const result: unknown = JSON.parse(text.slice(start, offset));
        if (typeof result !== "string" || !validUnicode(result) || result.includes("\0")) return fail();
        return result;
      }
      if (char === "\\") {
        const escape = text[offset++];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset, offset + 4))) return fail();
          offset += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) return fail();
      } else if (char.charCodeAt(0) < 32) return fail();
    }
    return fail();
  }
  function value(depth: number): ExactJson {
    if (depth > 64 || ++nodes > 100000) return fail();
    space(); const char = text[offset];
    if (char === '"') return string();
    if (char === "{") {
      offset++; space();
      const result: Record<string, ExactJson> = Object.create(null);
      if (text[offset] === "}") { offset++; return Object.freeze(result); }
      for (;;) {
        space(); if (text[offset] !== '"') return fail();
        const key = string();
        if (Object.prototype.hasOwnProperty.call(result, key)) return fail();
        space(); if (text[offset++] !== ":") return fail();
        result[key] = value(depth + 1);
        space(); const next = text[offset++];
        if (next === "}") return Object.freeze(result);
        if (next !== ",") return fail();
      }
    }
    if (char === "[") {
      offset++; space(); const result: ExactJson[] = [];
      if (text[offset] === "]") { offset++; return Object.freeze(result); }
      for (;;) {
        result.push(value(depth + 1)); space(); const next = text[offset++];
        if (next === "]") return Object.freeze(result);
        if (next !== ",") return fail();
      }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(offset));
    if (!match) return fail();
    offset += match[0].length;
    return new ExactJsonNumber(match[0]);
  }
  const result = value(0); space();
  if (offset !== text.length) return fail();
  return result;
}

/** Only explicitly bounded protocol integers may become ordinary JS numbers. */
export function protocolInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum)
    throw new Error("Expected safe protocol integer bounds");
  if (!(value instanceof ExactJsonNumber) || !/^(0|[1-9][0-9]*)$/.test(value.token))
    throw new Error("Expected an exact protocol integer");
  const integer = BigInt(value.token);
  if (integer < BigInt(minimum) || integer > BigInt(maximum)) throw new Error("Protocol integer exceeds its bound");
  return Number(integer);
}

/** Read bytes incrementally; never call Response.json() on review evidence. */
export async function readExactReviewResponse(response: Response): Promise<ExactJson> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Review request did not complete successfully");
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Expected a JSON review response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Review response body is unavailable");
  // One fixed buffer also bounds metadata when a server emits tiny/empty chunks.
  const raw = new Uint8Array(reviewResponseByteLimit); let size = 0;
  const deadline = performance.now() + 30000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Review response timed out; its server outcome is unconfirmed")), 30000);
  });
  async function consume(): Promise<ExactJson> {
    for (;;) {
      if (performance.now() >= deadline) throw new Error("Review response timed out; its server outcome is unconfirmed");
      const { value, done } = await reader!.read();
      if (performance.now() >= deadline) throw new Error("Review response timed out; its server outcome is unconfirmed");
      if (done) break;
      if (size + value.byteLength > reviewResponseByteLimit) throw new Error("Review response exceeds its size limit");
      raw.set(value, size); size += value.byteLength;
    }
    return decodeExactJson(raw.subarray(0, size));
  }
  try {
    // Race once: a pending timeout must not accumulate one reaction per chunk.
    return await Promise.race([consume(), timeout]);
  } catch (error) {
    // Cancellation is initiated, not credited as server rollback or completion.
    void reader.cancel().catch(() => {});
    throw error;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
