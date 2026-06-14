import { useState } from "react";
import {
  Home, MessageSquare, Phone, ClipboardList, MoreHorizontal,
  Users, FileText, Megaphone, BarChart3, AlertTriangle,
  Pill, Stethoscope, Settings, LayoutDashboard, Upload, X, Clock, History,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hub/contexts/AuthContext";
import { useUnreadCount } from "@/hub/hooks/use-conversations";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

const tabs = [
  { path: "/hub", label: "Home", icon: Home, exact: true },
  { path: "/hub/chats", label: "Comm", icon: MessageSquare },
  { path: "/hub/tickets", label: "Tickets", icon: ClipboardList },
  { path: "/hub/call", label: "Call", icon: Phone },
];

const moreItems = [
  { path: "/hub/clients", label: "Clients", icon: Users },
  { path: "/hub/time", label: "Time Clock", icon: Clock },
  { path: "/hub/timesheet", label: "Timesheet", icon: History },
  { path: "/hub/tools/templates", label: "Templates", icon: FileText },
  { path: "/hub/tools/campaigns", label: "Campaigns", icon: Megaphone },
  { path: "/hub/tools/surveys", label: "Surveys", icon: BarChart3 },
  { path: "/hub/tools/alerts", label: "Alerts", icon: AlertTriangle },
  { path: "/hub/tools/refills", label: "Refills", icon: Pill },
  { path: "/hub/tools/ezyvet", label: "Clinic Browser", icon: Stethoscope },
  { path: "/hub/settings", label: "Settings", icon: Settings },
];

const adminMoreItems = [
  { path: "/hub/admin", label: "Admin Dashboard", icon: LayoutDashboard },
  { path: "/hub/admin/import", label: "Import Clients", icon: Upload },
];

export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: unreadCount } = useUnreadCount();

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const isMoreActive = [...moreItems, ...adminMoreItems].some((item) => isActive(item.path));

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around bg-card/95 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
        aria-label="Hub navigation"
      >
        {tabs.map((tab) => {
          const active = isActive(tab.path, tab.exact);
          const badge = tab.path === "/hub/chats" ? (unreadCount ?? 0) : 0;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-w-[44px] min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl px-3 transition-all duration-200",
                active ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className={cn("h-5 w-5", active && "text-primary")} aria-hidden="true" />
              <span className={cn("text-[11px]", active ? "font-semibold" : "font-medium")}>{tab.label}</span>
              {badge > 0 && (
                <span className="absolute top-0.5 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          className={cn(
            "relative flex min-w-[44px] min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl px-3 transition-all duration-200",
            isMoreActive ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          <span className={cn("text-[11px]", isMoreActive ? "font-semibold" : "font-medium")}>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[70vh]">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">More</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-2 pb-4">
            {moreItems.map((item) => (
              <button
                key={item.path}
                onClick={() => { navigate(item.path); setMoreOpen(false); }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-2xl p-3 transition-colors",
                  isActive(item.path) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-[11px] font-medium text-center leading-tight">{item.label}</span>
              </button>
            ))}
            {isAdmin && adminMoreItems.map((item) => (
              <button
                key={item.path}
                onClick={() => { navigate(item.path); setMoreOpen(false); }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-2xl p-3 transition-colors",
                  isActive(item.path) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-[11px] font-medium text-center leading-tight">{item.label}</span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
