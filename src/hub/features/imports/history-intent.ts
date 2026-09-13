export type HistoryOperation = "approval" | "extraction" | "discrepancy";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function historyIntentKey(
  actor: string,
  pet: string,
  kind: HistoryOperation,
) {
  if (!uuid.test(actor) || !uuid.test(pet))
    throw new Error("Invalid clinical review identity");
  return `ezyvet-history-intent:${actor}:${pet}:${kind}`;
}
export function readHistoryIntent(key: string): string | null {
  try {
    const id = sessionStorage.getItem(key);
    return id && uuid.test(id) ? id : null;
  } catch {
    return null;
  }
}
/** No source prose or local clinical fields are persisted in browser storage. */
export function saveHistoryIntent(key: string, id: string) {
  if (!uuid.test(id)) throw new Error("Invalid clinical review request");
  try {
    sessionStorage.setItem(key, id);
  } catch {
    throw new Error(
      "Browser recovery storage is unavailable. No review request was submitted.",
    );
  }
}
export function clearHistoryIntent(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Server discovery retains the receipt. */
  }
}
