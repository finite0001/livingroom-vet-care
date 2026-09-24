import { documentLinkRuntime } from "../../supabase/functions/_shared/document-link-runtime.ts";
import {
  createStaffDocumentLinkHandler,
  createRetrieveDocumentLinkHandler,
} from "../../supabase/functions/_shared/document-link-http.ts";
const deps = documentLinkRuntime();
const handlers: Record<string, (req: Request) => Promise<Response>> = {
  "/prepare": createStaffDocumentLinkHandler(deps, "prepare"),
  "/recover": createStaffDocumentLinkHandler(deps, "recover"),
  "/retrieve": createRetrieveDocumentLinkHandler(deps),
  "/off": createRetrieveDocumentLinkHandler({
    ...deps,
    config: deps.config ? { ...deps.config, publicEnabled: false } : null,
  }),
  "/removed-key": createRetrieveDocumentLinkHandler({
    ...deps,
    config: deps.config ? { ...deps.config, keys: {} } : null,
  }),
  "/changed-origin": createRetrieveDocumentLinkHandler({
    ...deps,
    config: deps.config
      ? { ...deps.config, origin: "https://changed.example.test" }
      : null,
  }),
};
Deno.serve(
  {
    hostname: "127.0.0.1",
    port: Number(Deno.env.get("DOCUMENT_LINK_TEST_PORT") || 56451),
  },
  (req) =>
    handlers[new URL(req.url).pathname]?.(req) ??
    new Response(null, { status: 404 }),
);
