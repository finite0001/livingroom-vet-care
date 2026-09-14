import { createReleaseApiOriginalReader } from "./release-api-original-download.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {
  documentLinkConfig,
  type DocumentLinkConfig,
} from "./document-link-capability.ts";
import type { LinkDependencies } from "./document-link-http.ts";
export function documentLinkRuntime(): LinkDependencies {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(
    url,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let config: DocumentLinkConfig | null = null;
  try {
    config = documentLinkConfig({
      origin: Deno.env.get("DOCUMENT_LINK_ORIGIN"),
      activeKeyVersion: Deno.env.get("DOCUMENT_LINK_ACTIVE_KEY_VERSION"),
      keys: Deno.env.get("DOCUMENT_LINK_KEYS"),
      publicEnabled: Deno.env.get("DOCUMENT_LINK_PUBLIC_ENABLED"),
    });
  } catch {
    /* Missing or invalid commissioned configuration fails closed, without logging keys. */
  }
  return {
    config,
    service,
    authenticate: async (token) => {
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user) return null;
      return {
        actorId: data.user.id,
        db: createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      };
    },
    readApiOriginal: createReleaseApiOriginalReader({ service, url, serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, apiKey: Deno.env.get("SUPABASE_ANON_KEY")! }),
    download: async (bucket, path, expectedSize) => {
      const { data, error } = await service.storage.from(bucket).download(path);
      if (error) throw error;
      if (!data || data.size !== expectedSize)
        throw new Error("Original size differs");
      return new Uint8Array(await data.arrayBuffer());
    },
    practice: {
      name: "The Living Room Veterinary Care",
      address: "2619 Spruce Street, Boulder, CO",
      domain: "thelivingroom.vet",
    },
  };
}
