import { useState } from "react";
import {
  Home, MessageSquare, Users, Phone, Settings,
  ClipboardList, AudioWaveform, FileText, Megaphone,
  AlertTriangle, BarChart3, Pill, Stethoscope,
  LayoutDashboard, Upload, ChevronDown, LogOut,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hub/contexts/AuthContext";
import { useUnreadCount } from "@/hub/hooks/use-conversations";

const workspaceItems = [
  { path: "/hub", label: "Home", icon: Home, exact: true },
  { path: "/hub/chats", label: "Communication", icon: MessageSquare },
  { path: "/hub/tickets", label: "Tickets", icon: ClipboardList },
  { path: "/hub/clients", label: "Clients", icon: Users },
  { path: "/hub/call", label: "Phone", icon: Phone },
  { path: "/hub/voicemails", label: "Voicemails", icon: AudioWaveform },
];

const toolItems = [
  { path: "/hub/tools/templates", label: "Templates", icon: FileText },
  { path: "/hub/tools/campaigns", label: "Campaigns", icon: Megaphone },
  { path: "/hub/tools/surveys", label: "Surveys", icon: BarChart3 },
  { path: "/hub/tools/alerts", label: "Alerts", icon: AlertTriangle },
  { path: "/hub/tools/refills", label: "Refills", icon: Pill },
  { path: "/hub/tools/ezyvet", label: "Clinic Browser", icon: Stethoscope },
];

const adminItems = [
  { path: "/hub/admin", label: "Dashboard", icon: LayoutDashboard },
  { path: "/hub/admin/import", label: "Import", icon: Upload },
];

export function DesktopSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasRole, signOut } = useAuth();
  const isAdmin = hasRole("ADMIN");

  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const renderItem = (item: { path: string; label: string; icon: React.ElementType; exact?: boolean }) => {
    const active = isActive(item.path, item.exact);
    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-primary/10 text-primary font-semibold border-l-[3px] border-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:translate-x-0.5 transition-all duration-150"
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">{item.label}</span>
      </button>
    );
  };

  if (collapsed) return null;

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-sidebar-background">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <span className="text-primary font-bold text-sm">LRV</span>
        </div>
        <span className="text-base font-bold text-primary">Hub</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-2" aria-label="Hub navigation">
        <div className="border-b border-sidebar-border/50 pb-2">
          <button
            onClick={() => setWorkspaceOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            Workspace
            <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", workspaceOpen && "rotate-180")} />
          </button>
          {workspaceOpen && (
            <div className="mt-0.5 space-y-0.5">
              {workspaceItems.map(renderItem)}
            </div>
          )}
        </div>

        <div className="border-b border-sidebar-border/50 pb-2">
          <button
            onClick={() => setToolsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            Tools
            <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", toolsOpen && "rotate-180")} />
          </button>
          {toolsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {toolItems.map(renderItem)}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Admin</p>
            {adminItems.map(renderItem)}
          </div>
        )}
      </nav>

      <div className="border-t p-3 space-y-0.5">
        {renderItem({ path: "/hub/settings", label: "Settings", icon: Settings })}
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
