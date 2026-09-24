import {
  Activity,
  BellRing,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  History,
  Home,
  LayoutDashboard,
  MessageSquare,
  Package,
  PawPrint,
  Pill,
  Settings,
  Ticket,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

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
  exact?: boolean;
  /** Whether this item appears in the mobile bottom-tab bar. */
  tab?: boolean;
}

export const navItems: NavItem[] = [
  // Workspace
  { path: "/hub", label: "Home", icon: Home, section: "workspace", exact: true, tab: true },
  { path: "/hub/chats", label: "Messages", mobileLabel: "Msgs", icon: MessageSquare, section: "workspace", tab: true },
  { path: "/hub/tickets", label: "Tickets", icon: Ticket, section: "workspace", tab: true },
  { path: "/hub/schedule", label: "Schedule", icon: CalendarDays, section: "workspace", tab: true },
  { path: "/hub/appointments", label: "Appointments", icon: CalendarDays, section: "workspace" },
  { path: "/hub/inventory", label: "Inventory", icon: Package, section: "workspace" },
  { path: "/hub/inquiries", label: "New inquiries", icon: ClipboardList, section: "workspace" },
  { path: "/hub/contact-submissions", label: "Contact submissions", mobileLabel: "Submissions", icon: ClipboardList, section: "workspace" },
  { path: "/hub/clients", label: "Clients", icon: Users, section: "workspace" },
  { path: "/hub/patients", label: "Patients", icon: PawPrint, section: "workspace" },
  { path: "/hub/time", label: "Time Clock", icon: Clock, section: "workspace" },
  { path: "/hub/timesheet", label: "Timesheet", icon: History, section: "workspace" },

  // Tools
  { path: "/hub/tools/care-reminders", label: "Care reminders", icon: BellRing, section: "tools" },
  { path: "/hub/deliveries", label: "Outbound deliveries", mobileLabel: "Deliveries", icon: Package, section: "tools" },
  { path: "/hub/tools/templates", label: "Templates", icon: FileText, section: "tools" },
  { path: "/hub/tools/refills", label: "Refills", icon: Pill, section: "tools" },

  // Admin
  { path: "/hub/admin/operations", label: "Operations", icon: Activity, section: "admin" },
  { path: "/hub/admin", label: "Dashboard", mobileLabel: "Admin Dashboard", icon: LayoutDashboard, section: "admin" },
  { path: "/hub/admin/staff", label: "Staff", icon: UserCog, section: "admin" },

  // Settings (rendered in the sidebar footer)
  { path: "/hub/settings", label: "Settings", icon: Settings, section: "settings" },
];

export const workspaceItems = navItems.filter((i) => i.section === "workspace");
export const toolItems = navItems.filter((i) => i.section === "tools");
export const adminItems = navItems.filter((i) => i.section === "admin");
export const settingsItem = navItems.find((i) => i.section === "settings")!;
export const tabItems = navItems.filter((i) => i.tab);
