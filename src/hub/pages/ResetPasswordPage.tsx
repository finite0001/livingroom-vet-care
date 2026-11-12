import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { takePasswordSetupLink } from "@/hub/lib/password-setup-link";
import { preparePasswordSetup, PasswordSetupPolicyError, type PasswordSetupSession } from "@/hub/lib/password-setup-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [checking, setChecking] = useState(true);
  const [setup, setSetup] = useState<PasswordSetupSession | null>(null);
  const live = useRef(false);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    live.current = true;
    const link = takePasswordSetupLink();
    const invalid = "This link has expired or is invalid. Request a new password reset from sign in.";
    if (!link) {
      setError(invalid);
      setChecking(false);
    } else {
      void preparePasswordSetup(link, () => alive && live.current).then(result => {
        if (alive && live.current) setSetup(result);
      }).catch(() => { if (alive) setError(invalid); })
        .finally(() => { if (alive) setChecking(false); });
    }
    // A new fragment never silently changes the reviewed password target.
    const invalidate = () => {
      live.current = false;
      window.history.replaceState(null, "", "/hub/reset-password");
      setSetup(null); setPassword(""); setConfirmation(""); setError(invalid); setChecking(false);
    };
    window.addEventListener("hashchange", invalidate);
    window.addEventListener("pagehide", invalidate);
    return () => {
      alive = false; live.current = false;
      window.removeEventListener("hashchange", invalidate);
      window.removeEventListener("pagehide", invalidate);
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!setup || !live.current || saving) return;
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setSaving(true);
    setError("");
    try {
      await setup.save(password);
      if (!live.current) return;
      setComplete(true);
      setSetup(null);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      if (live.current) {
        if (!(cause instanceof PasswordSetupPolicyError)) setSetup(null);
        setError(cause instanceof Error ? cause.message : "Password could not be saved. Request a new link and try again.");
      }
    } finally { if (live.current) setSaving(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">{complete ? "Password saved" : "Set your password"}</h1>
        {checking && <p role="status" className="text-sm text-muted-foreground">Verifying your link…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {complete ? <><p className="text-sm text-muted-foreground">Your password is saved. Sign in with your email and new password.</p><Button asChild><Link to="/hub/login">Return to sign in</Link></Button></> : setup && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">Account: <strong className="break-all text-foreground">{setup.email}</strong>. Only save a password if this is the account you intended to use.</p>
            <p className="text-sm text-muted-foreground">For new invitations and password resets, choose a password with at least 12 characters.</p>
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" autoComplete="new-password" type="password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" autoComplete="new-password" type="password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
            <Button className="w-full" disabled={saving} type="submit">{saving ? "Saving…" : "Save password"}</Button>
          </form>
        )}
        <Link className="block text-sm text-primary underline" to="/hub/login" onClick={() => { live.current = false; }}>Back to sign in</Link>
      </section>
    </main>
  );
}
