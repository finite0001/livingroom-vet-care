/** Synthetic local HTTP harness. The runner restricts Deno networking to localhost. */
import { stripeCheckoutRuntime, stripeWebhookRuntime, stripeWorkerRuntime } from "../../supabase/functions/_shared/stripe-runtime.ts";
Deno.env.set("STRIPE_PAYMENTS_ENABLED", "false");
Deno.env.set("STRIPE_WEBHOOK_ENABLED", "false");
const disabledCheckout = stripeCheckoutRuntime();
const disabledWebhook = stripeWebhookRuntime();
Deno.env.set("STRIPE_PAYMENTS_ENABLED", "true");
Deno.env.set("STRIPE_WEBHOOK_ENABLED", "true");
const checkout = stripeCheckoutRuntime();
const webhook = stripeWebhookRuntime();
Deno.serve({hostname: "127.0.0.1", port: 56461}, request => {
  switch (new URL(request.url).pathname) {
    case "/health": return new Response("ready");
    case "/checkout-off": return disabledCheckout(request);
    case "/webhook-off": return disabledWebhook(request);
    case "/checkout": return checkout(request);
    case "/webhook": return webhook(request);
    case "/worker": return stripeWorkerRuntime(request);
    default: return new Response(null, {status: 404});
  }
});
