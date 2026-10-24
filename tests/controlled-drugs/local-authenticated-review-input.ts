import { z } from "zod";
import { reviewUuidSchema } from "../../src/hub/features/controlled-drugs/record-review/request.ts";

const token = z.string().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).max(16384);
export const localAuthenticatedReviewInputSchema = z.object({
  origin: z.literal("http://127.0.0.1:64661"), anonKey: token,
  session: z.object({ actorId: reviewUuidSchema, sessionId: reviewUuidSchema, generation: z.literal(1), accessToken: token }).strict(),
  selection: z.object({ actor_id: reviewUuidSchema, event_id: reviewUuidSchema, policy_id: reviewUuidSchema,
    read_eligibility_id: reviewUuidSchema, review_eligibility_id: reviewUuidSchema }).strict(),
}).strict().superRefine((value, ctx) => {
  try {
    const decode = (jwt: string): unknown => {
      const segment = jwt.split(".")[1], bytes = Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    };
    // This filters accidental real/service inputs; the real local server, not
    // this decoding operation, verifies the reviewer JWT signature/session.
    z.object({ role: z.literal("anon") }).passthrough().parse(decode(value.anonKey));
    const claims = z.object({ sub: reviewUuidSchema, session_id: reviewUuidSchema, role: z.literal("authenticated"),
      email: z.string().regex(/^lrv-closed-[a-f0-9]{16}-1@example\.invalid$/) }).passthrough().parse(decode(value.session.accessToken));
    if (claims.sub !== value.session.actorId || claims.session_id !== value.session.sessionId || value.selection.actor_id !== value.session.actorId)
      throw new Error("Synthetic identity mismatch");
  } catch { ctx.addIssue({ code: "custom", message: "Only the fixed disposable local reviewer is supported" }); }
});
export interface LocalAuthenticatedReviewInput {
  origin: "http://127.0.0.1:64661";
  anonKey: string;
  session: { actorId: string; sessionId: string; generation: 1; accessToken: string };
  selection: { actor_id: string; event_id: string; policy_id: string; read_eligibility_id: string; review_eligibility_id: string };
}
