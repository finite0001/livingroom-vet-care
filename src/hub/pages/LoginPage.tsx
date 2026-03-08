import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } else {
      navigate("/hub");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({ title: "Enter your email", description: "Please enter your email address first.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/hub/login`,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setResetSent(true);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-primary/10" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary/8 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

      <div className="relative z-10 w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-card p-3 shadow-lg border border-border">
            <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center" role="img" aria-label="The Living Room Vet logo">
              <span className="text-primary font-bold text-xl" aria-hidden="true">LRV</span>
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">The Living Room Vet</h1>
            <p className="text-sm text-muted-foreground mt-1">Staff Communications Hub</p>
          </div>
        </div>

        {resetMode ? (
          <div className="rounded-2xl bg-card border border-border p-6 shadow-lg space-y-4">
            {resetSent ? (
              <div className="text-center space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-base font-semibold text-foreground">Check your email</h2>
                <p className="text-sm text-muted-foreground">We sent a password reset link to <strong className="text-foreground">{email}</strong></p>
                <Button variant="ghost" size="sm" onClick={() => { setResetMode(false); setResetSent(false); }}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="text-center">
                  <h2 className="text-base font-semibold text-foreground">Reset your password</h2>
                  <p className="text-sm text-muted-foreground mt-1">Enter your email and we'll send a reset link</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setResetMode(false)}>
                  Back to sign in
                </Button>
              </form>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-card border border-border p-6 shadow-lg">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button type="button" onClick={() => setResetMode(true)} className="text-xs text-primary hover:text-primary/80 font-medium">
                    Forgot password?
                  </button>
                </div>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
              </div>
              <Button type="submit" className="w-full shadow-sm hover:shadow-md transition-all" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => navigate("/hub/signup")}>
                Create account
              </Button>
            </form>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <a href="/" className="font-medium text-primary hover:text-primary/80 underline-offset-4 hover:underline">
            ← Back to main site
          </a>
        </p>
      </div>
    </div>
  );
}
