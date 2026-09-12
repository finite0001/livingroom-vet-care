import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    // Capture callback errors before the auth client removes URL fragments.
    const callback = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    if (callback.has("error") || query.has("error")) {
      setError("This link has expired or is invalid. Request a new password reset from sign in.");
      setChecking(false);
      return;
    }
    // getSession waits for Supabase's automatic URL token exchange to finish.
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;
      setReady(!sessionError && Boolean(data.session));
      if (sessionError || !data.session) setError("This link has expired or is invalid. Request a new password reset from sign in.");
      setChecking(false);
    }).catch(() => {
      if (!alive) return;
      setError("Unable to verify this link. Request a new password reset from sign in.");
      setChecking(false);
    });
    return () => { alive = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setSaving(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password could not be saved. Request a new link and try again.");
    } finally { setSaving(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">{complete ? "Password saved" : "Set your password"}</h1>
        {checking && <p role="status" className="text-sm text-muted-foreground">Verifying your link…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {complete ? <><p className="text-sm text-muted-foreground">Your staff password is ready.</p><Button asChild><Link to="/hub">Continue to the hub</Link></Button></> : ready && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">For new invitations and password resets, choose a password with at least 12 characters.</p>
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" autoComplete="new-password" type="password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" autoComplete="new-password" type="password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
            <Button className="w-full" disabled={saving} type="submit">{saving ? "Saving…" : "Save password"}</Button>
          </form>
        )}
        <Link className="block text-sm text-primary underline" to="/hub/login">Back to sign in</Link>
      </section>
    </main>
  );
}
