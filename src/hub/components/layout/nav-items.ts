import {
  Activity,
  BellRing,
  CalendarDays,
  Clock,
  DatabaseZap,
  FileText,
  History,
  Home,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Package,
  Send,
  Phone,
  PawPrint,
  Pill,
  Settings,
  Ticket,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cloudtalkEnabled } from "../../../config/cloudtalk.ts";

/**
 * Single source of truth for hub navigation. Both DesktopSidebar and
 * BottomTabBar consume this list so labels, paths and icons cannot drift.
 * Every item has a distinct icon.
 */
export interface NavItem {
  path: string;
  label: string;
  /** Shorter label used by the mobile bottom-tab bar. */
  mobileLabel?: string;
  icon: LucideIcon;
  section: "workspace" | "tools" | "admin" | "settings";
  /** Only the exact path lights this item (no child segments). */
  exact?: boolean;
  /**
   * Extra routes that belong to this item — usually detail pages whose URL
   * does not sit under `path` (e.g. `/hub/patient/:id` for Patients). A
   * prefix ending in "/" matches anything below it; otherwise it matches the
   * path itself and its child segments.
   */
  activePrefixes?: string[];
  /** Whether this item appears in the mobile bottom-tab bar. */
  tab?: boolean;
}

export const navItems: NavItem[] = [
  // Workspace
  { path: "/hub", label: "Home", icon: Home, section: "workspace", exact: true, tab: true },
  { path: "/hub/chats", label: "Messages", mobileLabel: "Msgs", icon: MessageSquare, section: "workspace", tab: true, activePrefixes: ["/hub/conversation/", "/hub/inbox/"] },
  ...(cloudtalkEnabled ? [{ path: "/hub/call", label: "Phone", icon: Phone, section: "workspace" as const, activePrefixes: ["/hub/voicemails"] }] : []),
  { path: "/hub/tickets", label: "Tickets", icon: Ticket, section: "workspace", tab: true, activePrefixes: ["/hub/ticket/"] },
  { path: "/hub/schedule", label: "Schedule", icon: CalendarDays, section: "workspace", tab: true },
  { path: "/hub/inventory", label: "Inventory", icon: Package, section: "workspace" },
  { path: "/hub/inquiries", label: "New inquiries", icon: Inbox, section: "workspace" },
  { path: "/hub/clients", label: "Clients", icon: Users, section: "workspace", activePrefixes: ["/hub/client/"] },
  { path: "/hub/patients", label: "Patients", icon: PawPrint, section: "workspace", activePrefixes: ["/hub/patient/", "/hub/whogot"] },
  { path: "/hub/time", label: "Time Clock", icon: Clock, section: "workspace" },
  { path: "/hub/timesheet", label: "Timesheet", icon: History, section: "workspace" },

  // Tools
  { path: "/hub/tools/care-reminders", label: "Care reminders", icon: BellRing, section: "tools" },
  { path: "/hub/deliveries", label: "Outbound deliveries", mobileLabel: "Deliveries", icon: Send, section: "tools" },
  { path: "/hub/tools/templates", label: "Templates", icon: FileText, section: "tools" },
  { path: "/hub/tools/refills", label: "Refills", icon: Pill, section: "tools" },

  // Admin
  { path: "/hub/admin/operations", label: "Operations", icon: Activity, section: "admin", activePrefixes: ["/hub/admin/outbox"] },
  { path: "/hub/admin", label: "Dashboard", mobileLabel: "Admin Dashboard", icon: LayoutDashboard, section: "admin", exact: true },
  { path: "/hub/admin/staff", label: "Staff", icon: UserCog, section: "admin" },
  { path: "/hub/tools/ezyvet", label: "ezyVet import", icon: DatabaseZap, section: "admin" },

  // Settings (rendered in the sidebar footer)
  { path: "/hub/settings", label: "Settings", icon: Settings, section: "settings" },
];

export const workspaceItems = navItems.filter((i) => i.section === "workspace");
export const toolItems = navItems.filter((i) => i.section === "tools");
export const adminItems = navItems.filter((i) => i.section === "admin");
export const settingsItem = navItems.find((i) => i.section === "settings")!;
export const tabItems = navItems.filter((i) => i.tab);

/** `pathname` is `path` itself or (unless `exact`) one of its child segments. */
function matchesSegment(pathname: string, path: string, exact?: boolean): boolean {
  if (pathname === path) return true;
  if (exact) return false;
  return pathname.startsWith(path.endsWith("/") ? path : `${path}/`);
}

/**
 * Shared active-state rule for the sidebar and the bottom-tab bar. Matches on
 * whole path segments, so `/hub/time` does not light up on `/hub/timesheet`.
 */
export function isNavItemActive(item: Pick<NavItem, "path" | "exact" | "activePrefixes">, pathname: string): boolean {
  if (matchesSegment(pathname, item.path, item.exact)) return true;
  return item.activePrefixes?.some((prefix) => matchesSegment(pathname, prefix)) ?? false;
}
