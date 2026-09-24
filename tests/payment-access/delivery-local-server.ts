/** Production runtime over localhost. No provider transport keys or external networking. */
import {paymentDeliveryStaffRuntime} from "../../supabase/functions/_shared/payment-delivery-staff-runtime.ts";
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(Deno.env.get("SUPABASE_URL")??""))throw new Error("Local database required");
const handler=paymentDeliveryStaffRuntime();
Deno.serve({hostname:"127.0.0.1",port:56501},request=>new URL(request.url).pathname==="/health"?new Response("ready"):handler(request));
