import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hub/contexts/AuthContext";

interface Props {
  requiredRole?: string;
}

export function ProtectedRoute({ requiredRole }: Props) {
  const { user, profile, roles, authError, refreshProfile, loading, hasRole, signOut } = useAuth();

  // A staff member whose account was deactivated mid-session still holds a valid
  // token. DB RLS blocks their data, but without this they'd sit in the Hub UI
  // (and see admin buttons). End the session and bounce them to login.
  const deactivated = !!user && profile?.is_active === false;
  useEffect(() => {
    if (!loading && deactivated) void signOut().catch(() => { /* Access remains denied if server sign-out fails. */ });
  }, [loading, deactivated, signOut]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user || deactivated) {
    return <Navigate to="/hub/login" replace />;
  }

  if (!profile || !roles.length || authError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="max-w-sm space-y-4 text-foreground">
          <h1 className="text-xl font-semibold">Staff access unavailable</h1>
          <p role="alert" className="text-sm text-muted-foreground">{authError || "An active staff profile is required. Contact an administrator."}</p>
          <button className="mr-4 text-primary underline" onClick={() => void refreshProfile()}>Retry</button>
          <button className="text-primary underline" onClick={() => void signOut().catch(() => { window.location.assign("/hub/login"); })}>Back to sign in</button>
        </div>
      </main>
    );
  }

  if (requiredRole && !hasRole(requiredRole)) {
    return <Navigate to="/hub" replace />;
  }

  return <Outlet />;
}
