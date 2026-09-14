import { attachmentCaptureRuntime } from "./runtime.ts";
Deno.serve(attachmentCaptureRuntime(name => Deno.env.get(name)));
