import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hub/contexts/AuthContext";

export default function SignupPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signUp } = useAuth();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signUp(email, password, firstName, lastName);
    setLoading(false);
    if (error) {
      toast({ title: "Signup failed", description: error, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent you a confirmation link." });
      navigate("/hub/login");
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
            <h1 className="text-xl font-bold text-foreground">Create account</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter your details to get started</p>
          </div>
        </div>

        <div className="rounded-2xl bg-card border border-border p-6 shadow-lg">
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signupEmail">Email</Label>
              <Input id="signupEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signupPassword">Password</Label>
              <Input id="signupPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" minLength={6} />
            </div>
            <Button type="submit" className="w-full shadow-sm hover:shadow-md transition-all" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/hub/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
