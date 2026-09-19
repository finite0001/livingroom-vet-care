import {externalRecordVerificationRuntime} from "../../supabase/functions/_shared/external-record-verification-runtime.ts";
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(Deno.env.get("SUPABASE_URL")??""))throw new Error("Local database required");
const handler=externalRecordVerificationRuntime();
Deno.serve({hostname:"127.0.0.1",port:56521},request=>new URL(request.url).pathname==="/health"?new Response("ready"):handler(request));
