import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Retired: every client message must pass through durable enqueue and suppression.
serve((request: Request) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
    "Content-Type": "application/json",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers });
  return new Response(JSON.stringify({
    error: "This direct-send endpoint is retired. Use the reviewed communication queue workflow.",
    accepted: false,
    delivered: false,
    queue_rejected: true,
  }), { status: 410, headers });
});
