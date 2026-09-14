import { attachmentRuntimeAccess } from "../ezyvet-attachment-capture/runtime.ts";
import { createCleanupHandler } from "./handler.ts";
export function attachmentCleanupRuntime(env: (name: string) => string | undefined, transport: typeof fetch = fetch) {
  return createCleanupHandler({ env, now: Date.now, gateway: attachmentRuntimeAccess(env, transport) });
}
