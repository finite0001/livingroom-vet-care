import { useProfiles, getDvmInitials } from "@/hub/hooks/use-profiles";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AssignmentDropdownProps {
  currentAssigneeId?: string | null;
  onAssign: (dvmId: string | null) => void;
}

const DVM_COLORS = ["bg-primary text-primary-foreground", "bg-emerald-600 text-white", "bg-violet-600 text-white"];

export function AssignmentDropdown({ currentAssigneeId, onAssign }: AssignmentDropdownProps) {
  const { data: profiles } = useProfiles();
  const dvms = profiles?.filter((p) => p.role === "DVM") ?? [];
  const assignee = profiles?.find((p) => p.id === currentAssigneeId);
  const dvmIndex = dvms.findIndex((d) => d.id === currentAssigneeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label={assignee ? `Assigned to ${assignee.full_name}` : "Unassigned"}>
          <Avatar className="h-7 w-7">
            <AvatarFallback className={cn("text-xs font-semibold", assignee ? DVM_COLORS[dvmIndex] ?? "bg-muted" : "bg-muted text-muted-foreground")}>
              {assignee ? getDvmInitials(assignee) : "—"}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onAssign(null)}><span className="text-muted-foreground">Unassigned</span></DropdownMenuItem>
        {dvms.map((dvm, i) => (
          <DropdownMenuItem key={dvm.id} onClick={() => onAssign(dvm.id)}>
            <Avatar className="h-5 w-5 mr-2"><AvatarFallback className={cn("text-[10px] font-semibold", DVM_COLORS[i])}>{getDvmInitials(dvm)}</AvatarFallback></Avatar>
            {dvm.full_name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
