interface DraftStorage {
  length: number;
  key: (index: number) => string | null;
  removeItem: (key: string) => void;
}
/** Retain pending invoice text only for the currently authenticated staff identity. */
export function clearOtherInvoiceEmailIntents(
  storage: DraftStorage,
  actorId: string | null,
): void {
  const prefixes = [
    "invoice-email-intent:",
    "document-link-intent:",
    "invoice-payment-intent:",
  ];
  for (const prefix of prefixes) {
    const retained = actorId ? `${prefix}${actorId}:` : null;
    const remove: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix) && (!retained || !key.startsWith(retained)))
        remove.push(key);
    }
    for (const key of remove) storage.removeItem(key);
  }
}

export function clearInvoiceEmailSession(actorId: string | null): void {
  try {
    clearOtherInvoiceEmailIntents(window.sessionStorage, actorId);
  } catch {
    // Blocked browser storage must never prevent authentication or signout.
    // The composer requires writable session storage before creating an intent.
  }
}
