import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { parseReleasePreview } from "../record-releases/api";
import { renderRecordRelease } from "../record-releases/print";
import type {
  ReleasePreview,
  ReleasePackageContext,
} from "../record-releases/print";
import {
  actionSchemas,
  choicesSchema,
  cursorSchema,
  detailSchema,
  documentsSchema,
  filterSchema,
  packagesSchema,
  pageSchema,
  receiptSchema,
  type RequestAction,
} from "./model";
const uuid = z.string().uuid();
interface RequestRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as RequestRpc).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
export async function queue(
  filter: z.infer<typeof filterSchema>,
  before: z.infer<typeof cursorSchema> | null,
) {
  return pageSchema.parse(
    await rpc("list_record_requests", {
      p_filter: filterSchema.parse(filter),
      p_before: cursorSchema.nullable().parse(before),
      p_limit: 50,
    }),
  );
}
export async function detail(id: string) {
  return detailSchema
    .nullable()
    .parse(await rpc("read_record_request", { p_id: uuid.parse(id) }));
}
export async function choices(
  search: string,
  pet: string | null,
  client: string | null,
  after: string | null = null,
) {
  return choicesSchema.parse(
    await rpc("record_request_choices", {
      p_search: z.string().max(160).parse(search),
      p_pet_id: uuid.nullable().parse(pet),
      p_client_id: uuid.nullable().parse(client),
      p_after: uuid.nullable().parse(after),
    }),
  );
}
export async function documents(id: string, after: string | null) {
  return documentsSchema.parse(
    await rpc("list_record_request_documents", {
      p_request_id: uuid.parse(id),
      p_after: uuid.nullable().parse(after),
    }),
  );
}
export async function packages(id: string, manifest: string, after: number) {
  return packagesSchema.parse(
    await rpc("list_record_request_packages", {
      p_request_id: uuid.parse(id),
      p_manifest_id: uuid.parse(manifest),
      p_after: z.number().int().nonnegative().parse(after),
      p_limit: 20,
    }),
  );
}
const contextSchema = z.object({
  manifest_id: uuid,
  manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
  ordinal: z.number().int().positive(),
  package_count: z.number().int().positive(),
  captured_at: z.string(),
  recipient_kind: z.enum(["client", "third_party"]),
  recipient_name: z.string().nullable(),
  authorization: z
    .object({
      id: uuid,
      recorded_at: z.string(),
      expires_at: z.string(),
      recorded_by_name: z.string(),
    })
    .nullable(),
});
export interface PackageReview {
  id: string;
  preview: ReleasePreview;
  package_context: ReleasePackageContext;
  confirmed: boolean;
  release_id: string;
  scope_expansion: boolean;
}
export async function packageReview(
  id: string,
  packageId: string,
): Promise<PackageReview> {
  const row = z
    .object({
      id: uuid,
      preview: z.unknown(),
      package_context: contextSchema,
      confirmed: z.boolean(),
      release_id: uuid,
      scope_expansion: z.boolean(),
    })
    .parse(
      await rpc("read_record_request_package", {
        p_request_id: uuid.parse(id),
        p_package_id: uuid.parse(packageId),
      }),
    );
  const preview = parseReleasePreview(row.preview);
  if (!preview || row.id !== packageId)
    throw new Error("Numbered package identity is invalid");
  renderRecordRelease({
    preview,
    package_context: row.package_context as ReleasePackageContext,
  });
  return { ...row, preview } as PackageReview;
}
export async function evidence(
  id: string,
  kind: "sources" | "exclusions" | "receipts" | "history",
  after: number,
) {
  return z
    .object({
      items: z.array(z.record(z.unknown())).max(50),
      next: z.number().int().nonnegative().nullable(),
    })
    .parse(
      await rpc("list_record_request_evidence", {
        p_id: uuid.parse(id),
        p_kind: z
          .enum(["sources", "exclusions", "receipts", "history"])
          .parse(kind),
        p_after: z.number().int().nonnegative().parse(after),
        p_limit: 50,
      }),
    );
}
export function validateAction(action: RequestAction): RequestAction {
  const kind = z
    .enum([
      "save",
      "manifest",
      "confirm",
      "receive",
      "transition",
      "authorize",
      "revoke_authorization",
    ])
    .parse(action.kind);
  return {
    kind,
    entityId: uuid.parse(action.entityId),
    expectedVersion: z
      .number()
      .int()
      .positive()
      .nullable()
      .parse(action.expectedVersion),
    values: actionSchemas[kind].parse(action.values),
  };
}
const names = {
  save: "save_record_request",
  manifest: "prepare_record_request_manifest",
  confirm: "confirm_record_request_package",
  receive: "receive_record_request",
  transition: "transition_record_request",
  authorize: "authorize_record_request_recipient",
  revoke_authorization: "revoke_record_request_authorization",
};
export async function saveRequestAction(
  actionId: string,
  submitted: RequestAction,
) {
  const action = validateAction(submitted),
    args: Record<string, unknown> = {
      p_action_id: uuid.parse(actionId),
      p_expected_version: action.expectedVersion,
      p_values: action.values,
    };
  args[action.kind === "save" ? "p_id" : "p_request_id"] = action.entityId;
  const receipt = receiptSchema.parse(await rpc(names[action.kind], args));
  if (receipt.request.id !== action.entityId)
    throw new Error("Saved request identity changed");
  return receipt;
}
export async function readRequestAction(
  actionId: string,
  submitted: RequestAction,
) {
  const a = validateAction(submitted);
  return receiptSchema.nullable().parse(
    await rpc("read_record_request_action", {
      p_action_id: uuid.parse(actionId),
      p_request_id: a.entityId,
      p_kind: a.kind,
      p_expected_version: a.expectedVersion,
      p_values: a.values,
    }),
  );
}

export type { RequestAction } from "./model";
