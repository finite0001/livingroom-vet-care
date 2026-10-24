import { ExactJsonNumber } from "./exact-json.ts";

/** Display only. Exact numeric tokens are copied as text; no authoritative JSON
 * serialization or packet hash is produced. Every field remains available. */
export function displayReviewEvidence(value: unknown): string {
  const parts: string[] = [];
  function visit(item: unknown) {
    if (item instanceof ExactJsonNumber) { parts.push(String(item)); return; }
    if (item === null || typeof item === "string" || typeof item === "boolean") { parts.push(JSON.stringify(item)); return; }
    if (Array.isArray(item)) {
      parts.push("["); item.forEach((entry, index) => { if (index) parts.push(",\n"); visit(entry); }); parts.push("]"); return;
    }
    if (!item || typeof item !== "object") throw new Error("Review evidence is unavailable");
    parts.push("{"); Object.entries(item).forEach(([key, entry], index) => {
      if (index) parts.push(",\n"); parts.push(`${JSON.stringify(key)}: `); visit(entry);
    }); parts.push("}");
  }
  visit(value); return parts.join("");
}
