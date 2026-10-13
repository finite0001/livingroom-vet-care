import { z } from "zod";
const uuid = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const diagnosticReleaseScopeSchema = z
  .object({
    binding_version: z.literal(1),
    job_id: uuid,
    pet_id: uuid,
    panel_id: uuid,
    mode: z.enum(["current", "historical"]),
    version: z.number().int().positive(),
    label: z.string(),
    reviewed_at: z.string().datetime({ offset: true }),
    source_hash: hash,
    snapshot_hash: hash,
    manifest_sha256: hash,
    sha256: hash,
    byte_length: z.number().int().min(1).max(3145728),
    embedded_versions: z
      .array(
        z
          .object({
            id: uuid,
            panel_id: uuid,
            version: z.number().int().positive(),
            label: z.string(),
            reviewed_at: z.string().datetime({ offset: true }),
            source_hash: hash,
          })
          .strict(),
      )
      .min(1)
      .max(200),
    total_panels: z.number().int().positive().max(100000),
    export_available: z.literal(false),
    scope_expansion_required: z.boolean(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.embedded_versions.map((x) => x.panel_id)).size !==
        v.embedded_versions.length ||
      v.total_panels < v.embedded_versions.length ||
      v.scope_expansion_required !== v.embedded_versions.length > 1 ||
      !v.embedded_versions.some(
        (x) =>
          x.id === v.job_id &&
          x.panel_id === v.panel_id &&
          x.source_hash === v.source_hash &&
          x.version === v.version,
      )
    )
      c.addIssue({
        code: "custom",
        message: "Exact embedded diagnostic census required",
      });
  });
