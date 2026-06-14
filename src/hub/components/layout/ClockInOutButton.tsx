import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, LogIn, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function formatElapsed(start: Date, now: Date) {
  const ms = Math.max(0, now.getTime() - start.getTime());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function ClockInOutButton() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());

  const { data: openShift } = useQuery({
    queryKey: ["time-entries", "open", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("time_entries")
        .select("id, clock_in_at, clock_out_at")
        .eq("staff_id", user!.id)
        .is("clock_out_at", null)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; clock_in_at: string; clock_out_at: string | null } | null;
    },
  });

  useEffect(() => {
    if (!openShift) return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [openShift]);

  const clockIn = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("clock_in");
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Clocked in", description: "Your shift has started." });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    },
    onError: (e: any) => toast({ title: "Couldn't clock in", description: e.message, variant: "destructive" }),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("clock_out");
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Clocked out", description: "Your shift has ended." });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    },
    onError: (e: any) => toast({ title: "Couldn't clock out", description: e.message, variant: "destructive" }),
  });

  const elapsed = useMemo(
    () => (openShift ? formatElapsed(new Date(openShift.clock_in_at), now) : null),
    [openShift, now],
  );

  if (!user) return null;
  const onDuty = !!openShift;
  const pending = clockIn.isPending || clockOut.isPending;

  return (
    <div className="flex items-center gap-2">
      {onDuty && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
          title={`On duty since ${new Date(openShift!.clock_in_at).toLocaleTimeString()}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <Clock className="h-3 w-3" />
          {elapsed}
        </span>
      )}
      <Button
        size="sm"
        variant={onDuty ? "outline" : "default"}
        disabled={pending}
        onClick={() => (onDuty ? clockOut.mutate() : clockIn.mutate())}
        className={cn("h-8", onDuty && "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400")}
      >
        {onDuty ? <LogOut className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
        <span className="ml-1.5">{onDuty ? "Clock Out" : "Clock In"}</span>
      </Button>
    </div>
  );
}
