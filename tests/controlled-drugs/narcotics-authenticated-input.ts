/** Closed disposable-local input; never a production connection fallback. */
import { z } from "zod";
import { reviewUuidSchema } from "../../src/hub/features/controlled-drugs/record-review/request.ts";
export const narcoticsAuthenticatedInputSchema = z.object({
  origin: z.literal("http://127.0.0.1:64661"),
  anonKey: z.string().max(16384).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  actorId: reviewUuidSchema,
  scope: z.object({ product_id: reviewUuidSchema, site_id: reviewUuidSchema }).strict(),
}).strict().superRefine((value, ctx) => {
  try {
    const bytes = Uint8Array.from(atob(value.anonKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    z.object({ role: z.literal("anon") }).passthrough().parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { ctx.addIssue({ code: "custom", message: "A disposable local anonymous gateway key is required" }); }
});
export interface NarcoticsAuthenticatedInput {
  readonly origin: "http://127.0.0.1:64661"; readonly anonKey: string; readonly actorId: string;
  readonly scope: { readonly product_id: string; readonly site_id: string };
}
