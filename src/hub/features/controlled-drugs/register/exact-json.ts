import { ExactJsonNumber, validUnicode, type ExactJson } from "../record-review/exact-json.ts";

/** Register envelope has a separate eight-MiB bound; old review limits stay fixed. */
export function decodeRegisterJson(raw: Uint8Array): ExactJson {
  if (raw.byteLength === 0 || raw.byteLength > 8 * 1024 * 1024) throw new Error("Review response size is invalid");
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
