import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const STAFF_ROLES = new Set(["ADMIN", "DVM", "TECH", "STAFF"]);
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader || "" } } });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("id, is_active, role").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (profileRes.error) throw profileRes.error;
    const roles = new Set([profileRes.data?.role, ...(rolesRes.data ?? []).map((r: { role: string }) => r.role)].filter(Boolean));
    const isActiveStaff = profileRes.data?.is_active === true && [...roles].some((r) => STAFF_ROLES.has(r as string));
    if (!isActiveStaff) return jsonResponse({ error: "Forbidden" }, 403);

    const { provider_id, subject, body, client_id, pet_id, attachment_paths } = await req.json();
    if (!provider_id || !subject || !body) return jsonResponse({ error: "Missing required fields" }, 400);
    if (typeof body !== "string" || body.trim().length === 0 || body.length > 100000) return jsonResponse({ error: "Invalid body" }, 400);
    if (typeof subject !== "string" || subject.trim().length === 0 || subject.length > 500) return jsonResponse({ error: "Invalid subject" }, 400);
    if (attachment_paths !== undefined && (!Array.isArray(attachment_paths) || attachment_paths.length > MAX_ATTACHMENTS || attachment_paths.some((p) => typeof p !== "string"))) {
      return jsonResponse({ error: "Invalid attachments" }, 400);
    }

    // Recipient is bound to a provider_contacts row — staff cannot send to arbitrary addresses.
    const { data: provider, error: providerError } = await supabase
      .from("provider_contacts").select("id, name, email, is_active").eq("id", provider_id).maybeSingle();
    if (providerError) throw providerError;
    if (!provider || provider.is_active !== true) return jsonResponse({ error: "Provider not found or inactive" }, 404);
    if (!provider.email) return jsonResponse({ error: "Provider has no email on file" }, 400);

    // Attachments may only come from client_files rows for the named client,
    // so a path can't be pointed at another client's documents.
    const attachments: { filename: string; content: string }[] = [];
    if (attachment_paths?.length) {
      if (!client_id) return jsonResponse({ error: "client_id is required when sending attachments" }, 400);
      const { data: fileRows, error: filesError } = await supabase
        .from("client_files").select("file_path, file_name").eq("client_id", client_id).in("file_path", attachment_paths);
      if (filesError) throw filesError;
      if ((fileRows ?? []).length !== attachment_paths.length) {
        return jsonResponse({ error: "One or more attachments do not belong to this client" }, 403);
      }
      for (const row of fileRows!) {
        const { data: blob, error: dlError } = await supabase.storage.from("client-files").download(row.file_path);
        if (dlError || !blob) return jsonResponse({ error: `Could not read attachment ${row.file_name ?? row.file_path}` }, 400);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length > MAX_ATTACHMENT_BYTES) return jsonResponse({ error: `Attachment too large: ${row.file_name ?? row.file_path}` }, 400);
        attachments.push({ filename: row.file_name ?? row.file_path.split("/").pop() ?? "attachment", content: base64Encode(bytes) });
      }
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM");
    let delivered = false;
    let statusNote = "Delivery recorded. Email delivery pending Resend configuration.";
    let errorText: string | null = null;
    if (resendKey && fromAddress) {
      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromAddress,
            to: [provider.email],
            subject: String(subject),
            text: body.trim(),
            ...(attachments.length ? { attachments } : {}),
          }),
        });
        if (resp.ok) { delivered = true; statusNote = "Email sent via Resend."; }
        else { errorText = `Resend ${resp.status}: ${await resp.text()}`; statusNote = "Resend send failed."; }
      } catch (e) { errorText = e instanceof Error ? e.message : "Resend request failed"; statusNote = "Resend send failed."; }
    }

    const { error: logError } = await supabase.from("document_deliveries").insert({
      provider_id, client_id: client_id ?? null, pet_id: pet_id ?? null, channel: "EMAIL",
      recipient: provider.email, subject: String(subject), body_excerpt: body.trim().slice(0, 500),
      attachment_paths: attachment_paths ?? null, delivered, status_note: statusNote, error_text: errorText, sent_by: user.id,
    });
    if (logError) console.error("send-provider-email: delivery log insert failed:", logError);

    return jsonResponse({ success: true, delivered, note: statusNote });
  } catch (e) {
    console.error("send-provider-email error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
