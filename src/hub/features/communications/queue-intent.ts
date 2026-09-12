export interface MessageIntent {
  conversation_id: string;
  channel: "SMS" | "EMAIL";
  to: string;
  subject: string;
  body: string;
  attachment_ids: string[];
}
export interface QueueReceipt {
  success: true;
  queued: true;
  outbox_id: string;
  message_id: string;
  state: string;
}
export interface QueueTransport {
  submit: (payload: MessageIntent & { request_id: string }) => Promise<QueueReceipt>;
  lookup: (requestId: string) => Promise<QueueReceipt | null>;
}
interface PendingIntent {
  requestId: string;
  fingerprint: string;
  payload: MessageIntent;
  running?: Promise<QueueReceipt>;
  attempts: number;
}
export class QueueRejectedError extends Error {}

/** One unresolved intent per authenticated composer scope; no patient text in browser storage. */
export class QueueIntentStore {
  private pending = new Map<string, PendingIntent>();
  has(scope: string) { return this.pending.has(scope); }
  clear() { this.pending.clear(); }
  async send(scope: string, payload: MessageIntent, transport: QueueTransport): Promise<QueueReceipt> {
    const fingerprint = JSON.stringify(payload);
    let intent = this.pending.get(scope);
    if (intent && intent.fingerprint !== fingerprint) {
      throw new Error("An earlier queue request is unresolved. Restore its original recipient, channel and text, then retry to check the same request. Do not create another message until its status is confirmed.");
    }
    if (intent?.running) return intent.running;
    if (!intent) {
      intent = { requestId: crypto.randomUUID(), fingerprint, payload: structuredClone(payload), attempts: 0 };
      this.pending.set(scope, intent);
    }
    const current = intent;
    current.attempts++;
    current.running = (async () => {
      try {
        const receipt = await transport.submit({ ...current.payload, request_id: current.requestId });
        this.pending.delete(scope);
        return receipt;
      } catch (error) {
        // Even a rejected retry may refer to a previously committed request.
        let receipt: QueueReceipt | null = null;
        try { receipt = await transport.lookup(current.requestId); } catch { /* Keep the exact intent when the read also fails. */ }
        if (receipt) { this.pending.delete(scope); return receipt; }
        if (error instanceof QueueRejectedError && current.attempts === 1) this.pending.delete(scope);
        throw error;
      } finally { current.running = undefined; }
    })();
    return current.running;
  }
}
