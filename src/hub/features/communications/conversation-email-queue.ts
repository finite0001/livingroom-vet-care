import { parseConversationEmailReview, type ConversationEmailReview } from "./conversation-email-review.ts";
import type { QueueTransport } from "./queue-intent.ts";
export interface ConversationEmailQueueClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  functions: { invoke(name: string, options: { body: { id: string } }): PromiseLike<{ data: unknown; error: unknown }> };
}
export interface ConversationEmailApproval { requestId: string; payloadHash: string }
/** Preserve common request recovery/acknowledgment while inserting explicit review before queueing. */
export function withConversationEmailReview(
  base: QueueTransport,
  client: ConversationEmailQueueClient,
  scope: string,
  checkActor: () => string,
  review: (value: ConversationEmailReview) => Promise<ConversationEmailApproval>,
): QueueTransport {
  return {
    ...base,
    prepare: async body => {
      if (!body.attachment_ids.length) return base.prepare(body);
      checkActor();
      if (body.channel !== "EMAIL") throw new Error("Attachments require email.");
      const { error } = await client.rpc("prepare_conversation_email", {
        p_request_id: body.request_id, p_scope: scope, p_conversation_id: body.conversation_id,
        p_recipient: body.to, p_subject: body.subject, p_body: body.body, p_attachment_ids: body.attachment_ids,
      });
      checkActor();
      if (error) throw error;
      // Reuse the ordinary authorized recovery parser and composer scope checks.
      const recovered = await base.recover(body.request_id);
      checkActor();
      if (!recovered) throw new Error("Attachment email preparation is unconfirmed. Recover this request.");
      return recovered;
    },
    submit: async body => {
      if (!body.attachment_ids.length) return base.submit(body);
      checkActor();
      if (body.channel !== "EMAIL") throw new Error("Attachments require email.");
      const { data, error } = await client.functions.invoke("capture-conversation-email", { body: { id: body.request_id } });
      checkActor();
      if (error) throw error;
      const saved = parseConversationEmailReview(data, { requestId: body.request_id, conversationId: body.conversation_id });
      if (JSON.stringify([saved.payload.to, saved.payload.subject, saved.payload.body, saved.payload.attachment_ids]) !==
        JSON.stringify([body.to, body.subject, body.body, body.attachment_ids])) throw new Error("Saved email differs from this draft. Recover it before reviewing.");
      if (saved.receipt) return saved.receipt;
      const approved = await review(saved);
      checkActor();
      if (approved.requestId !== saved.requestId || approved.payloadHash !== saved.payloadHash)
        throw new Error("Review changed. Review the exact saved email again.");
      const queued = await client.rpc("enqueue_conversation_email", {
        p_request_id: saved.requestId, p_reviewed_payload_hash: saved.payloadHash, p_attest: true,
      });
      checkActor();
      if (queued.error) throw queued.error;
      // Validate via the same durable receipt path used after a lost queue response.
      const recovered = await base.recover(saved.requestId);
      checkActor();
      if (!recovered?.receipt) throw new Error("Queue confirmation is incomplete. Recover this request.");
      return recovered.receipt;
    },
  };
}
