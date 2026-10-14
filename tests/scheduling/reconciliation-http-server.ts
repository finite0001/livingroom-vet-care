/** Execute the real Edge entrypoint; only its listen address changes for local proof. */
const serve = Deno.serve;
Deno.serve = ((handler: Deno.ServeHandler<Deno.NetAddr>) =>
  serve(
    { hostname: "127.0.0.1", port: 47293 },
    handler,
  )) as typeof Deno.serve;
await import("../../supabase/functions/reconcile-operational-tasks/index.ts");
