import {paymentAccessRuntime} from "../_shared/payment-access-runtime.ts";
Deno.serve(paymentAccessRuntime("status"));
