import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { boundedResponse, type PdfService } from "./processing.ts";
const bucketSchema = z.literal("diagnostic-pdfs");
const pathSchema = z
  .string()
  .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.pdf$/);
export function createPdfService(raw: unknown): PdfService {
  const config = z
    .object({
      url: z.string().url(),
      key: z.string().min(20),
      synthetic_local: z.boolean().default(false),
    })
    .strict()
    .parse(raw);
  const u = new URL(config.url);
  const hosted =
    u.protocol === "https:" &&
    [
      "kothoqicubowyhwfsrte.supabase.co",
      "mgadheotkdnrsatfivjy.supabase.co",
    ].includes(u.hostname);
  const local =
    config.synthetic_local &&
    u.protocol === "http:" &&
    u.hostname === "127.0.0.1" &&
    u.port === "64521";
  if (
    (!hosted && !local) ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  )
    throw new Error("Known practice or owned synthetic backend required");
  const db = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    rpc(name, args) {
      return db.rpc(name, args);
    },
    async upload(bucket, path, bytes) {
      bucketSchema.parse(bucket);
      pathSchema.parse(path);
      z.instanceof(Uint8Array)
        .refine((b) => b.byteLength > 0 && b.byteLength <= 3145728)
        .parse(bytes);
      const { error } = await db.storage
        .from(bucket)
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw error;
    },
    async download(bucket, path) {
      bucketSchema.parse(bucket);
      pathSchema.parse(path);
      const response = await fetch(
        `${u.origin}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
        {
          headers: {
            apikey: config.key,
            Authorization: `Bearer ${config.key}`,
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      return await boundedResponse(response);
    },
  };
}
