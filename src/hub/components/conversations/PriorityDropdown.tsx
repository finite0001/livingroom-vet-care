import { type ConversationPriority } from "@/hub/hooks/use-conversations";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AlertTriangle, Minus, ArrowDown } from "lucide-react";

interface PriorityDropdownProps {
  priority: ConversationPriority;
  onSetPriority: (priority: ConversationPriority) => void;
}

const PRIORITY_CONFIG: Record<ConversationPriority, { label: string; icon: React.ElementType; color: string }> = {
  URGENT: { label: "Urgent", icon: AlertTriangle, color: "text-destructive" },
  NORMAL: { label: "Normal", icon: Minus, color: "text-muted-foreground" },
  LOW: { label: "Low", icon: ArrowDown, color: "text-muted-foreground/60" },
};

export function PriorityBadge({ priority }: { priority: ConversationPriority }) {
  const config = PRIORITY_CONFIG[priority];
  if (priority === "NORMAL") return null;
  const Icon = config.icon;
  return <span className={cn("inline-flex items-center gap-0.5", config.color)} title={`Priority: ${config.label}`}><Icon className="h-3 w-3" /></span>;
}

export function PriorityDropdown({ priority, onSetPriority }: PriorityDropdownProps) {
  const config = PRIORITY_CONFIG[priority];
  const Icon = config.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md hover:bg-accent transition-colors" aria-label={`Priority: ${config.label}`}>
          <Icon className={cn("h-4 w-4", config.color)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {(Object.entries(PRIORITY_CONFIG) as [ConversationPriority, typeof config][]).map(([key, cfg]) => {
          const ItemIcon = cfg.icon;
          return (
            <DropdownMenuItem key={key} onClick={() => onSetPriority(key)} className={cn(key === priority && "bg-accent")}>
              <ItemIcon className={cn("h-4 w-4 mr-2", cfg.color)} /> {cfg.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
