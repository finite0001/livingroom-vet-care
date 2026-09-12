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
export interface PreparedRequest {
  request_id: string;
  payload: MessageIntent | null;
  status: "prepared" | "acknowledged" | "abandoned";
  receipt: QueueReceipt | null;
}
export interface RequestPointers {
  get: (scope: string) => string | null;
  set: (scope: string, requestId: string) => void;
  remove: (scope: string) => void;
}
export interface QueueTransport {
  prepare: (
    payload: MessageIntent & { request_id: string },
  ) => Promise<PreparedRequest>;
  recover: (requestId: string | null) => Promise<PreparedRequest | null>;
  resolve: (requestId: string, abandon: boolean) => Promise<PreparedRequest>;
  submit: (
    payload: MessageIntent & { request_id: string },
  ) => Promise<QueueReceipt>;
}
interface PendingIntent {
  requestId: string;
  payload: MessageIntent | null;
  receipt: QueueReceipt | null;
}
export class QueueRejectedError extends Error {}
const fingerprint = (p: MessageIntent) =>
  JSON.stringify([
    p.conversation_id,
    p.channel,
    p.to,
    p.subject,
    p.body,
    p.attachment_ids,
  ]);

/** Patient text lives in memory/server only. The optional browser adapter stores opaque UUIDs. */
export class QueueIntentStore {
  private pending = new Map<string, PendingIntent>();
  private running = new Map<
    string,
    { fingerprint: string; promise: Promise<QueueReceipt> }
  >();
  private generation = 0;
  private pointers: RequestPointers;
  constructor(
    pointers: RequestPointers = (() => {
      const ids = new Map<string, string>();
      return {
        get: (k: string) => ids.get(k) ?? null,
        set: (k: string, v: string) => {
          ids.set(k, v);
        },
        remove: (k: string) => {
          ids.delete(k);
        },
      };
    })(),
  ) {
    this.pointers = pointers;
  }
  has(scope: string) {
    return this.pending.has(scope) || !!this.pointers.get(scope);
  }
  clear() {
    this.generation++;
    this.pending.clear();
    this.running.clear();
  }
  private adopt(scope: string, value: PreparedRequest) {
    this.pointers.set(scope, value.request_id);
    this.pending.set(scope, {
      requestId: value.request_id,
      payload: value.payload,
      receipt: value.receipt,
    });
  }
  private forget(scope: string) {
    this.pointers.remove(scope);
    this.pending.delete(scope);
  }
  async recover(
    scope: string,
    transport: QueueTransport,
  ): Promise<PreparedRequest | null> {
    const generation = this.generation;
    const id = this.pointers.get(scope);
    const previous = this.pending.get(scope);
    const snapshot = await transport.recover(id);
    if (this.pending.get(scope) !== previous)
      throw new Error("Request changed; retry recovery.");
    if (generation !== this.generation)
      throw new Error(
        "Account changed; reopen this composer after signing in.",
      );
    if (snapshot) {
      if (snapshot.status === "abandoned") {
        this.forget(scope);
        return null;
      }
      this.adopt(scope, snapshot);
    } else if (id) {
      this.pending.set(scope, { requestId: id, payload: null, receipt: null });
      throw new Error(
        "Preparation is not yet confirmed. Retry recovery or discard this request before starting another.",
      );
    }
    return snapshot;
  }
  async resolve(scope: string, abandon: boolean, transport: QueueTransport) {
    const generation = this.generation;
    const id = this.pointers.get(scope);
    if (!id) return null;
    const result = await transport.resolve(id, abandon);
    if (generation !== this.generation)
      throw new Error(
        "Account changed; reopen this composer after signing in.",
      );
    this.forget(scope);
    return result;
  }
  send(
    scope: string,
    payload: MessageIntent,
    transport: QueueTransport,
  ): Promise<QueueReceipt> {
    const current = this.pending.get(scope);
    if (
      current?.payload &&
      fingerprint(current.payload) !== fingerprint(payload)
    )
      return Promise.reject(
        new Error(
          "An earlier request is unresolved. Recover or discard its exact saved draft before changing content.",
        ),
      );
    const running = this.running.get(scope);
    if (running)
      return running.fingerprint === fingerprint(payload)
        ? running.promise
        : Promise.reject(
            new Error(
              "An earlier request is unresolved; wait before changing its content.",
            ),
          );
    const generation = this.generation;
    const valid = () => {
      if (generation !== this.generation)
        throw new Error("Account changed; message preparation stopped.");
    };
    const work = (async () => {
      let intent = this.pending.get(scope);
      if (!intent) {
        await this.recover(scope, transport);
        valid();
        intent = this.pending.get(scope);
      }
      if (intent && !intent.payload)
        throw new Error(
          "An earlier preparation is unresolved. Recover or discard it before sending.",
        );
      if (
        intent?.payload &&
        fingerprint(intent.payload) !== fingerprint(payload)
      )
        throw new Error(
          "An earlier request is unresolved. Recover its exact saved draft before sending.",
        );
      if (!intent) {
        intent = {
          requestId: crypto.randomUUID(),
          payload: structuredClone(payload),
          receipt: null,
        };
        // Persist the opaque ID before any network request, including preparation.
        this.pointers.set(scope, intent.requestId);
        this.pending.set(scope, intent);
      }
      const candidate = intent;
      let snapshot: PreparedRequest | null = null;
      try {
        snapshot = await transport.prepare({
          ...payload,
          request_id: candidate.requestId,
        });
      } catch (error) {
        valid();
        try {
          snapshot = await transport.recover(candidate.requestId);
        } catch {
          /* Preserve unresolved request. */
        }
        if (!snapshot) {
          // Another tab may already own the one unresolved request for this scope.
          try {
            snapshot = await transport.recover(null);
          } catch {
            /* Preserve unresolved request. */
          }
        }
        if (!snapshot) throw error;
      }
      valid();
      this.adopt(scope, snapshot);
      if (
        !snapshot.payload ||
        fingerprint(snapshot.payload) !== fingerprint(payload) ||
        snapshot.status === "abandoned"
      )
        throw new Error(
          "A different saved request needs review before sending.",
        );
      let result = snapshot.receipt;
      if (!result) {
        try {
          result = await transport.submit({
            ...snapshot.payload,
            request_id: snapshot.request_id,
          });
        } catch (error) {
          valid();
          try {
            const found = await transport.recover(snapshot.request_id);
            if (found) {
              valid();
              this.adopt(scope, found);
              result = found.receipt;
            }
          } catch {
            /* Keep exact prepared intent when recovery also fails. */
          }
          if (!result) throw error;
        }
      }
      valid();
      // Queue success is known even if acknowledging the composer claim is interrupted.
      this.pending.set(scope, {
        requestId: snapshot.request_id,
        payload: snapshot.payload,
        receipt: result,
      });
      try {
        await transport.resolve(snapshot.request_id, false);
        valid();
        this.forget(scope);
      } catch {
        /* A reload can recover and acknowledge the same receipt. */
      }
      valid();
      return result;
    })();
    this.running.set(scope, {
      fingerprint: fingerprint(payload),
      promise: work,
    });
    void work
      .finally(() => {
        if (this.running.get(scope)?.promise === work)
          this.running.delete(scope);
      })
      .catch(() => {});
    return work;
  }
}
