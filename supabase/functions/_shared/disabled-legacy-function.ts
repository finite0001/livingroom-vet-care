import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-resend-signature, x-twilio-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

interface DisabledLegacyFunctionOptions {
  slug: string;
  replacement?: string;
}

export function serveDisabledLegacyFunction({ slug, replacement }: DisabledLegacyFunctionOptions) {
  serve((req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    return new Response(
      JSON.stringify({
        error: "Legacy Edge Function disabled before launch cutover",
        slug,
        replacement: replacement ?? null,
      }),
      {
        status: 410,
        headers,
      },
    );
  });
}
