import { createStaffDocumentLinkHandler } from "../_shared/document-link-http.ts";
import { documentLinkRuntime } from "../_shared/document-link-runtime.ts";
Deno.serve(createStaffDocumentLinkHandler(documentLinkRuntime(), "prepare"));
