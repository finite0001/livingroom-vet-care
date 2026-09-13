import {stripeWebhookRuntime} from "../_shared/stripe-runtime.ts";
Deno.serve(stripeWebhookRuntime());
