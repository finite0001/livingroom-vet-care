const productionProject = "mgadheotkdnrsatfivjy";
const originalProject = "ugpyjacqganaqtsiekay";
const publicNames = new Set([
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_CONTACT_INTAKE_URL",
  "VITE_CONTACT_TURNSTILE_SITE_KEY",
]);

// Vercel can expose its system metadata with VITE_ names during build. The app
// does not consume that metadata, and Vite would otherwise make it available to
// browser code, so strip the reserved platform namespace before loading env.
export function stripVercelSystemPublicEnv(env) {
  for (const name of Object.keys(env)) {
    if (name.startsWith("VITE_VERCEL_")) {
      delete env[name];
    }
  }
}

// Configuration checks only: these do not authenticate the key or inspect a database.
// Never interpolate environment values into errors, including malformed credentials.
export function verifyDeploymentEnvironment(explicit, resolved) {
  const target = explicit.VERCEL_ENV;
  if (!["production", "preview"].includes(target)) {
    throw new Error("Set VERCEL_ENV to production or preview for a deployment build.");
  }
  if (explicit.NODE_ENV && explicit.NODE_ENV !== "production") {
    throw new Error("Deployment builds require NODE_ENV=production or the Vite production default.");
  }
  for (const name of ["VITE_SUPABASE_PROJECT_ID", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
    if (!explicit[name] || explicit[name] !== explicit[name].trim()) {
      throw new Error(`Set ${name} explicitly in the deployment environment; repository .env fallback is not allowed.`);
    }
    if (resolved[name] !== explicit[name]) {
      throw new Error(`Resolved ${name} differs from the explicit deployment configuration.`);
    }
  }
  const unexpectedNames = Object.keys(resolved).filter((name) => name.startsWith("VITE_") && !publicNames.has(name));
  if (unexpectedNames.length) {
    const labels = unexpectedNames.map((name) => /^[A-Z0-9_]{1,100}$/.test(name) ? name : "[invalid variable name]").sort();
    throw new Error(`An unreviewed VITE_ variable would be exposed to browsers: ${labels.join(", ")}. Review the public configuration allowlist.`);
  }
  const project = explicit.VITE_SUPABASE_PROJECT_ID;
  if (!/^[a-z]{20}$/.test(project) || project === originalProject) {
    throw new Error("Select a valid dedicated Supabase project; the original Lovable backend is not a deployment target.");
  }
  if (target === "production" && project !== productionProject) {
    throw new Error("Production must use the approved Living Room Vet Supabase project.");
  }
  if (target === "preview" && project === productionProject) {
    throw new Error("Preview builds require a separate staging backend, not the reserved production project.");
  }
  if (explicit.VITE_SUPABASE_URL !== `https://${project}.supabase.co`) {
    throw new Error("The Supabase URL must exactly match the selected project HTTPS origin.");
  }
  const key = explicit.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    let payload;
    try {
      const parts = key.split(".");
      if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("Use a Supabase publishable key or a legacy anon key, never a secret or service-role key.");
    }
    if (payload?.role !== "anon" || payload?.ref !== project) {
      throw new Error("Legacy browser keys must have the anon role and match the selected project.");
    }
  }
  const endpoint = resolved.VITE_CONTACT_INTAKE_URL || "";
  const siteKey = resolved.VITE_CONTACT_TURNSTILE_SITE_KEY || "";
  if (Boolean(endpoint) !== Boolean(siteKey)) {
    throw new Error("Configure both contact intake and Turnstile, or leave both unset for disabled intake.");
  }
  if (endpoint && endpoint !== `${explicit.VITE_SUPABASE_URL}/functions/v1/public-contact`) {
    throw new Error("Contact intake must use the selected backend's public-contact function.");
  }
  return { target, project, contactEnabled: Boolean(endpoint) };
}
