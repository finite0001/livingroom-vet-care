import { useEffect, useState } from "react";
import { Clock, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hub/contexts/auth-context";
import { useCurrentShift, useClockIn, useClockOut, durationSeconds } from "@/hub/hooks/use-time-clock";

// Header quick-action for clocking in/out. Shares the use-time-clock hook (and
// its ["time-clock"] query cache) with the /hub/time page, so clocking in/out
// from either place keeps both — and the on-duty pill — in sync.
function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function ClockInOutButton() {
  const { profile } = useAuth();
  const { data: current } = useCurrentShift();
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!current) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [current]);

  if (!profile) return null;
  const onDuty = !!current;
  const pending = clockIn.isPending || clockOut.isPending;
  const errMsg = (e: unknown, fb: string) => (e as { message?: string })?.message || fb;

  const handle = () => {
    if (onDuty) {
      clockOut.mutate(undefined, {
        onSuccess: () => toast.success("Clocked out"),
        onError: (e) => toast.error(errMsg(e, "Couldn't clock out")),
      });
    } else {
      clockIn.mutate(undefined, {
        onSuccess: () => toast.success("Clocked in"),
        onError: (e) => toast.error(errMsg(e, "Couldn't clock in")),
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {onDuty && current && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success"
          title={`On duty since ${new Date(current.clock_in_at).toLocaleTimeString()}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          <Clock className="h-3 w-3" />
          {formatElapsed(durationSeconds(current, now))}
        </span>
      )}
      <Button
        size="sm"
        variant={onDuty ? "outline" : "default"}
        disabled={pending}
        onClick={handle}
        className={cn("h-8", onDuty && "border-success/40 text-success hover:bg-success/10 hover:text-success")}
      >
        {onDuty ? <LogOut className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
        <span className="ml-1.5">{onDuty ? "Clock Out" : "Clock In"}</span>
      </Button>
    </div>
  );
}
