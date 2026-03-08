import { useAuth } from "@/hub/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

interface UserHeaderProps {
  navHidden?: boolean;
  onToggleNav?: () => void;
}

export function UserHeader({ navHidden = false, onToggleNav }: UserHeaderProps) {
  const { profile } = useAuth();

  if (!profile) return null;

  const initials = `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
      <button
        onClick={onToggleNav}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label={navHidden ? "Show navigation" : "Hide navigation"}
      >
        {navHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>

      <Avatar className="h-8 w-8">
        <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium text-foreground">{profile.full_name}</span>
    </div>
  );
}
