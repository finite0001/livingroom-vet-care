import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createDiagnosticPdfDownloadHandler } from "../_shared/diagnostic-pdf-download.ts";
const url = new URL(Deno.env.get("SUPABASE_URL")!);
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  !(
    (url.protocol === "https:" &&
      [
        "kothoqicubowyhwfsrte.supabase.co",
        "mgadheotkdnrsatfivjy.supabase.co",
      ].includes(url.hostname)) ||
    (url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "kong"].includes(url.hostname))
  )
)
  throw new Error("Known practice backend required");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const client = (token?: string) =>
  createClient(url.origin, token ? Deno.env.get("SUPABASE_ANON_KEY")! : key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token
      ? { global: { headers: { Authorization: `Bearer ${token}` } } }
      : {}),
  });
Deno.serve(
  createDiagnosticPdfDownloadHandler({
    authenticate: async (token) => {
      const { data, error } = await client().auth.getUser(token);
      if (error || !data.user) return null;
      return { actorId: data.user.id, db: client(token) };
    },
    service: { rpc: (name, args) => client().rpc(name, args) },
    download: (context) =>
      fetch(
        new URL(
          `/storage/v1/object/authenticated/diagnostic-pdfs/${context.object_path.split("/").map(encodeURIComponent).join("/")}`,
          url,
        ),
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Accept: "application/pdf",
            "Accept-Encoding": "identity",
          },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      ),
  }),
);
