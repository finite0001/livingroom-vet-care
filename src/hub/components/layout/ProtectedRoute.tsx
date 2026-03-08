import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hub/contexts/AuthContext";

interface Props {
  requiredRole?: string;
}

export function ProtectedRoute({ requiredRole }: Props) {
  const { user, loading, hasRole } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/hub/login" replace />;
  }

  if (requiredRole && !hasRole(requiredRole)) {
    return <Navigate to="/hub" replace />;
  }

  return <Outlet />;
}
