import { attachmentCleanupRuntime } from "./runtime.ts";
Deno.serve(attachmentCleanupRuntime(name => Deno.env.get(name)));
