import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hub/contexts/AuthContext";

interface Props {
  requiredRole?: string;
}

export function ProtectedRoute({ requiredRole }: Props) {
  const { user, profile, loading, hasRole, signOut } = useAuth();

  // A staff member whose account was deactivated mid-session still holds a valid
  // token. DB RLS blocks their data, but without this they'd sit in the Hub UI
  // (and see admin buttons). End the session and bounce them to login.
  const deactivated = !!user && profile?.is_active === false;
  useEffect(() => {
    if (!loading && deactivated) signOut();
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

  if (requiredRole && !hasRole(requiredRole)) {
    return <Navigate to="/hub" replace />;
  }

  return <Outlet />;
}
