import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTeam } from "./use-team";
export function MilestoneNotice() {
  const { query, perform, pending, error } = useTeam();
  const milestone = query.data?.milestones[0];
  if (!milestone) return null;
  const name =
    query.data?.staff.find((s) => s.id === milestone.staff_id)?.name ??
    "A teammate";
  const dismiss = (snooze: boolean) =>
    void perform("dismiss_milestone", {
      source_key: milestone.source_key,
      snooze,
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss(true);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {milestone.kind === "birthday"
              ? `Happy birthday, ${name}!`
              : `Happy work anniversary, ${name}!`}
          </DialogTitle>
          <DialogDescription>
            {milestone.kind === "birthday"
              ? "A day to celebrate our teammate."
              : `${milestone.years} years with the team.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert">{error}</p>}
        <div className="flex gap-3">
          <Button disabled={pending} onClick={() => dismiss(false)}>
            Dismiss for this year
          </Button>
          <Button
            disabled={pending}
            variant="outline"
            onClick={() => dismiss(true)}
          >
            Remind me in an hour
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
