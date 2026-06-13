import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Role = "ADMIN" | "DVM" | "TECH" | "STAFF";
const ROLES: Role[] = ["ADMIN", "DVM", "TECH", "STAFF"];

interface StaffRow {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  phone: string | null;
}

export default function AdminStaffPage() {
  usePageTitle("Staff Management");
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: staff, isLoading, error } = useQuery({
    queryKey: ["admin-staff"],
    queryFn: async (): Promise<StaffRow[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, full_name, role, is_active, phone")
        .order("is_active", { ascending: false })
        .order("last_name");
      if (error) throw error;
      return data as StaffRow[];
    },
    enabled: isAdmin,
  });

  const toggleActive = useMutation({
    mutationFn: async (row: StaffRow) => {
      setBusyId(row.id);
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: (_d, row) => {
      toast.success(`${row.full_name} ${row.is_active ? "deactivated" : "activated"}`);
      qc.invalidateQueries({ queryKey: ["admin-staff"] });
    },
    onError: (e: Error) => toast.error(e.message || "Update failed"),
    onSettled: () => setBusyId(null),
  });

  const changeRole = useMutation({
    mutationFn: async ({ row, role }: { row: StaffRow; role: Role }) => {
      setBusyId(row.id);
      // Update profile role
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ role })
        .eq("id", row.id);
      if (pErr) throw pErr;
      // Replace user_roles rows
      const { error: dErr } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", row.id);
      if (dErr) throw dErr;
      const { error: iErr } = await supabase
        .from("user_roles")
        .insert({ user_id: row.id, role });
      if (iErr) throw iErr;
    },
    onSuccess: (_d, { row, role }) => {
      toast.success(`${row.full_name} role changed to ${role}`);
      qc.invalidateQueries({ queryKey: ["admin-staff"] });
    },
    onError: (e: Error) => toast.error(e.message || "Role change failed"),
    onSettled: () => setBusyId(null),
  });

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-6">
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>You must be an admin to view this page.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Staff Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Activate, deactivate, or change roles for Hub staff accounts.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Invitations</AlertTitle>
        <AlertDescription>
          Self-service signup is disabled. To onboard a new staff member, create their
          account from the Lovable Cloud backend (Users → Add user), then activate and
          assign a role here.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff accounts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">
              {(error as Error).message}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(staff ?? []).map((row) => {
                  const busy = busyId === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.full_name || "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {row.id.slice(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.phone || "—"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.role}
                          disabled={busy}
                          onValueChange={(v) =>
                            changeRole.mutate({ row, role: v as Role })
                          }
                        >
                          <SelectTrigger className="w-[120px] h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {row.is_active ? (
                          <Badge variant="default">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={row.is_active ? "outline" : "default"}
                          disabled={busy}
                          onClick={() => toggleActive.mutate(row)}
                        >
                          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                          {row.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(staff ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No staff accounts found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
