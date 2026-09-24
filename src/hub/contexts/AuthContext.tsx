import { useEffect, useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearInvoiceEmailSession } from "./session-draft-retention";
import { createAuthRequestState } from "./auth-request-state";
import type { AuthRequest } from "./auth-request-state";
import { AuthContext, type Profile } from "./auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [authError, setAuthError] = useState<string | null>(null);
  const requests = useRef(createAuthRequestState());
  const invalidateRequests = useCallback(() => { requests.current.invalidate(); }, []);

  const fetchProfile = useCallback(async (request: AuthRequest) => {
    if (!requests.current.isCurrent(request) || !request.userId) return;
    const userId = request.userId;
    if (!request.preserveAccess) {
      setLoading(true);
      setProfile(null);
      setRoles([]);
      setAuthError(null);
    }
    try {
      const [profileRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("id, first_name, last_name, full_name, role, is_active").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (!profileRes.data || !rolesRes.data?.length) throw new Error("Your staff access could not be verified. Contact an administrator or retry.");
      if (!requests.current.resolve(request, profileRes.data.is_active)) return;
      if (!profileRes.data.is_active) clearInvoiceEmailSession(null);
      setAuthError(null);
      setProfile(profileRes.data);
      setRoles(profileRes.data.is_active ? rolesRes.data.map((row) => row.role) : []);
    } catch {
      if (!requests.current.resolve(request, false)) return;
      clearInvoiceEmailSession(null);
      setProfile(null);
      setRoles([]);
      setAuthError("Your staff access could not be verified. Contact an administrator or retry.");
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return;
      clearInvoiceEmailSession(nextSession?.user.id ?? null);
      const request = requests.current.begin(nextSession?.user.id ?? null);
      if (request.identityChanged) queryClient.clear();
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!request.preserveAccess) {
        setProfile(null);
        setRoles([]);
        setAuthError(null);
        setLoading(Boolean(nextSession));
      }
      if (nextSession) {
        // Do not call Supabase inside its auth callback: the auth lock is held.
        setTimeout(() => {
          if (alive && requests.current.isCurrent(request)) void fetchProfile(request);
        }, 0);
      }
    });
    // INITIAL_SESSION owns initialization; a second getSession request can race it.
    return () => {
      alive = false;
      invalidateRequests();
      subscription.unsubscribe();
    };
  }, [fetchProfile, invalidateRequests, queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async () => {
    return { error: "Staff accounts are invitation-only. Ask an administrator to create your account." };
  }, []);

  const signOut = useCallback(async () => {
    requests.current.invalidate();
    clearInvoiceEmailSession(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setProfile(null);
      setRoles([]);
      setLoading(false);
      setAuthError("Sign out failed. Retry or close this browser session.");
      throw error;
    }
    setProfile(null);
    setRoles([]);
  }, []);

  const refreshProfile = useCallback(async () => {
    const request = user ? requests.current.refresh(user.id) : null;
    if (request) await fetchProfile(request);
  }, [user, fetchProfile]);

  const hasRole = useCallback((role: string) => roles.includes(role), [roles]);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, roles, authError, signIn, signUp, signOut, refreshProfile, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}
