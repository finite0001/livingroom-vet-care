import { useState } from "react";
import {
  ChevronDown,
  LogOut,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hub/contexts/auth-context";
import { useUnreadCount } from "@/hub/hooks/use-conversations";
import {
  adminItems,
  settingsItem,
  toolItems,
  workspaceItems,
  type NavItem,
} from "./nav-items";

export function DesktopSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasRole, signOut } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const {
    data: unreadCount,
    isError: unreadError,
    isPending: unreadPending,
  } = useUnreadCount();

  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const renderItem = (item: NavItem & { badge?: number }) => {
    const active = isActive(item.path, item.exact);
    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        aria-current={active ? "page" : undefined}
        aria-label={
          item.path === "/hub/chats"
            ? `Inbox, ${unreadError ? "unread count unavailable" : unreadPending ? "loading unread count" : `${unreadCount} unread for you`}`
            : undefined
        }
        className={cn(
          "relative flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-primary/15 text-terracotta-dark font-semibold"
            : "text-sidebar-foreground hover:bg-gold/20 hover:text-foreground",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">{item.label}</span>
        {item.path === "/hub/chats" && unreadError && (
          <span className="text-xs text-muted-foreground">?</span>
        )}
        {!(item.path === "/hub/chats" && unreadError) &&
          (item.badge ?? 0) > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-terracotta text-cream-light text-[10px] font-bold px-1.5">
              {item.badge! > 99 ? "99+" : item.badge}
            </span>
          )}
      </button>
    );
  };

  if (collapsed) return null;

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <img
          src="/brand/living-room-medical-mark-v1.png"
          alt=""
          aria-hidden="true"
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 object-contain"
        />
        <span className="font-heading text-base font-bold text-terracotta-dark">
          Hub
        </span>
        <span className="sr-only">The Living Room Vet staff hub</span>
      </div>
      <nav
        className="flex-1 overflow-y-auto p-3 space-y-2"
        aria-label="Hub navigation"
      >
        <div className="border-b border-sidebar-border/50 pb-2">
          <button
            onClick={() => setWorkspaceOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            Workspace
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                workspaceOpen && "rotate-180",
              )}
            />
          </button>
          {workspaceOpen && (
            <div className="mt-0.5 space-y-0.5">
              {workspaceItems.map((item) =>
                item.path === "/hub/chats"
                  ? renderItem({ ...item, badge: unreadCount })
                  : renderItem(item),
              )}
            </div>
          )}
        </div>

        <div className="border-b border-sidebar-border/50 pb-2">
          <button
            onClick={() => setToolsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            Tools
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                toolsOpen && "rotate-180",
              )}
            />
          </button>
          {toolsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {toolItems.map(renderItem)}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Admin
            </p>
            {adminItems.map(renderItem)}
          </div>
        )}
      </nav>

      <div className="border-t p-3 space-y-0.5">
        {renderItem(settingsItem)}
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
