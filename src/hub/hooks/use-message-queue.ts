import { useEffect, useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  QueueIntentStore,
  QueueRejectedError,
  type MessageIntent,
  type PreparedRequest,
  type QueueReceipt,
  type QueueTransport,
} from "@/hub/features/communications/queue-intent";

function pointer(key: string) {
  try {
    return sessionStorage.getItem(`lrv-message-request:${key}`);
  } catch {
    return null;
  }
}
const intents = new QueueIntentStore({
  get: (key) => sessionStorage.getItem(`lrv-message-request:${key}`),
  set: (key, id) => sessionStorage.setItem(`lrv-message-request:${key}`, id),
  remove: (key) => sessionStorage.removeItem(`lrv-message-request:${key}`),
});
let activeActor: string | null = null;
function receipt(value: unknown): QueueReceipt | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<QueueReceipt>;
  return r.success === true &&
    r.queued === true &&
    typeof r.outbox_id === "string" &&
    typeof r.message_id === "string" &&
    typeof r.state === "string"
    ? (r as QueueReceipt)
    : null;
}
function prepared(value: unknown): PreparedRequest | null {
  if (value === null) return null;
  if (!value || typeof value !== "object")
    throw new Error("Incomplete saved request response");
  const p = value as Partial<PreparedRequest>;
  if (
    typeof p.request_id !== "string" ||
    !["prepared", "acknowledged", "abandoned"].includes(p.status ?? "")
  )
    throw new Error("Invalid saved request response");
  if (
    p.payload &&
    (typeof p.payload.body !== "string" ||
      typeof p.payload.to !== "string" ||
      typeof p.payload.subject !== "string" ||
      typeof p.payload.conversation_id !== "string" ||
      !["EMAIL", "SMS"].includes(p.payload.channel) ||
      !Array.isArray(p.payload.attachment_ids))
  )
    throw new Error("Invalid saved message payload");
  if (p.receipt && !receipt(p.receipt))
    throw new Error("Invalid saved queue receipt");
  return p as PreparedRequest;
}
export interface MessageRecovery {
  status: "loading" | "prepared" | "queued" | "unavailable";
  requestId: string | null;
  payload: MessageIntent | null;
  receipt: QueueReceipt | null;
  error?: string;
}
export function useMessageQueue(scope: string, active = true) {
  const { session } = useAuth();
  const actor = session?.user.id ?? null;
  const current = useRef(actor);
  current.current = actor;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const queryClient = useQueryClient();
  const key = `${actor}:${scope}`;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const pending = pendingKey === key;
  const setPending = (value: boolean) =>
    setPendingKey((existing) =>
      value ? key : existing === key ? null : existing,
    );
  const [recoveryState, setRecoveryState] = useState<{
    key: string;
    value: MessageRecovery | null;
  } | null>(null);
  const recovery = recoveryState?.key === key ? recoveryState.value : null;
  const setRecovery = (value: MessageRecovery | null) =>
    setRecoveryState({ key, value });
  const check = () => {
    if (
      !actor ||
      current.current !== actor ||
      currentScope.current !== scope ||
      activeActor !== actor
    )
      throw new Error("Sign in again before preparing a message.");
    return actor;
  };
  const transport: QueueTransport = {
    prepare: async (body) => {
      const { data, error } = await supabase.rpc("prepare_message_request", {
        p_actor_id: check(),
        p_request_id: body.request_id,
        p_scope: scope,
        p_conversation_id: body.conversation_id,
        p_channel: body.channel,
        p_recipient: body.to,
        p_subject: body.subject,
        p_body: body.body,
        p_attachment_ids: body.attachment_ids,
      });
      if (error) throw error;
      check();
      const result = prepared(data);
      if (!result) throw new Error("Preparation not confirmed");
      return result;
    },
    recover: async (requestId) => {
      const { data, error } = await supabase.rpc("recover_message_request", {
        p_actor_id: check(),
        p_scope: scope,
        p_request_id: requestId ?? undefined,
      });
      if (error) throw error;
      check();
      return prepared(data);
    },
    resolve: async (requestId, abandon) => {
      const { data, error } = await supabase.rpc("resolve_message_request", {
        p_actor_id: check(),
        p_scope: scope,
        p_request_id: requestId,
        p_abandon: abandon,
      });
      if (error) throw error;
      check();
      const result = prepared(data);
      if (!result) throw new Error("Request resolution not confirmed");
      return result;
    },
    submit: async (body) => {
      check();
      const { data, error } = await supabase.functions.invoke(
        "enqueue-message",
        { body },
      );
      check();
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const result = await error.context
            .clone()
            .json()
            .catch(() => null);
          if (result?.queue_rejected === true)
            throw new QueueRejectedError(
              result.error ||
                "Message was not queued. The prepared request is retained.",
            );
        }
        throw new Error(
          "Queue confirmation was lost. Recover the saved request or retry its exact content.",
        );
      }
      const result = receipt(data);
      if (!result)
        throw new Error(
          "Queue confirmation was incomplete. Recover the saved request.",
        );
      return result;
    },
  };
  const recover = async () => {
    if (!actor) return null;
    setRecovery({
      status: "loading",
      requestId: null,
      payload: null,
      receipt: null,
    });
    try {
      const saved = await intents.recover(key, transport);
      check();
      setRecovery(
        saved
          ? {
              status: saved.receipt ? "queued" : "prepared",
              requestId: saved.request_id,
              payload: saved.payload,
              receipt: saved.receipt,
            }
          : null,
      );
      return saved;
    } catch (error) {
      if (current.current === actor)
        setRecovery({
          status: "unavailable",
          requestId: pointer(key),
          payload: null,
          receipt: null,
          error:
            error instanceof Error
              ? error.message
              : "Saved request could not be loaded.",
        });
      throw error;
    }
  };
  useEffect(() => {
    if (activeActor !== actor) {
      intents.clear();
      activeActor = actor;
    }
    setRecovery(null);
    setPending(false);
    if (actor && active) void recover().catch(() => {});
    // Actor/scope changes start a fresh authorized recovery, never a send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, scope, active]);
  const send = async (payload: MessageIntent) => {
    check();
    setPending(true);
    try {
      const result = await intents.send(key, payload, transport);
      check();
      await Promise.all(
        [
          "messages",
          "conversation",
          "conversations",
          "communication-outbox",
        ].map((name) => queryClient.invalidateQueries({ queryKey: [name] })),
      );
      if (current.current === actor) await recover().catch(() => {});
      return result;
    } catch (error) {
      if (current.current === actor) await recover().catch(() => {});
      throw error;
    } finally {
      if (current.current === actor) setPending(false);
    }
  };
  const resolve = async (abandon: boolean) => {
    check();
    setPending(true);
    try {
      const result = await intents.resolve(key, abandon, transport);
      check();
      setRecovery(null);
      return result;
    } catch (error) {
      if (current.current === actor) await recover().catch(() => {});
      throw error;
    } finally {
      if (current.current === actor) setPending(false);
    }
  };
  return {
    send,
    pending,
    recovery,
    recover,
    discardRecovery: () => resolve(true),
    acknowledgeRecovery: () => resolve(false),
  };
}
