import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canInvite, invitationRedirect, isInvitationOriginAllowed, parseInvitation } from "./policy.ts";

serve(async (req) => {
  let redirectTo: string;
  try { redirectTo = invitationRedirect(Deno.env.get("APP_URL")); }
  catch { return new Response(JSON.stringify({ error: "Staff invitations are not configured" }), { status: 503, headers: { "Content-Type": "application/json" } }); }
  const headers = {
    "Access-Control-Allow-Origin": new URL(redirectTo).origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  const respond = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers });
  if (!isInvitationOriginAllowed(req.headers.get("Origin"), redirectTo)) return respond("Origin not allowed", 403);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return respond("Method not allowed", 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return respond("Unauthorized", 401);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !secret) return respond("Staff invitations are not configured", 503);
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) return respond("Unauthorized", 401);
    const [profile, roles] = await Promise.all([
      admin.from("profiles").select("is_active").eq("id", user.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (profile.error) throw profile.error;
    if (roles.error) throw roles.error;
    if (!canInvite(profile.data, roles.data ?? [])) return respond("Only active administrators can invite staff", 403);
    let invitation;
    try { invitation = parseInvitation(await req.json()); }
    catch { return respond("Provide a valid email, first name, and last name only", 400); }
    const { email, first_name, last_name } = invitation;
    // The database trigger assigns STAFF. Never accept role or redirect from the caller.
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { data: { first_name, last_name }, redirectTo });
    if (error) return respond("Invitation could not be sent. Check whether this account already exists or try again later.", 400);
    return new Response(JSON.stringify({ success: true }), { headers });
  } catch {
    return respond("Staff invitation failed. Try again later.", 500);
  }
});
