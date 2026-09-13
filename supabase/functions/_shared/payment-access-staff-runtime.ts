import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { paymentAccessConfig } from "./payment-access-capability.ts";
import {
  createStaffPaymentAccessHandler,
  type PaymentStaffDependencies,
} from "./payment-access-staff.ts";
function staffOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.origin === value &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)))
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
export function paymentAccessStaffRuntime(mode: "prepare" | "recover") {
  const client = (token?: string) =>
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get(token ? "SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(token
          ? { global: { headers: { Authorization: `Bearer ${token}` } } }
          : {}),
      },
    );
  const deps: PaymentStaffDependencies = {
    enabled: Deno.env.get("PAYMENT_ACCESS_STAFF_ENABLED") === "true",
    origin: staffOrigin(Deno.env.get("APP_URL")),
    authenticate: async (token) => {
      const { data, error } = await client().auth.getUser(token);
      if (error || !data.user) return null;
      return { actorId: data.user.id, db: client(token) };
    },
    service: {
      rpc: async (name, args) => {
        const { data, error } = await client().rpc(name, args);
        if (error) throw error;
        return { data, error: null };
      },
    },
    config: () =>
      paymentAccessConfig({
        origin: Deno.env.get("PAYMENT_ACCESS_ORIGIN"),
        activeKeyVersion: Deno.env.get("PAYMENT_ACCESS_ACTIVE_KEY_VERSION"),
        keys: Deno.env.get("PAYMENT_ACCESS_KEYS"),
      }),
  };
  return createStaffPaymentAccessHandler(deps, mode);
}
