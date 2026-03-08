import { useNavigate } from "react-router-dom";
import {
  MessageSquare, ClipboardList, Phone, Users,
  AudioWaveform, FileText, Megaphone, BarChart3,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hub/contexts/AuthContext";
import { cn } from "@/lib/utils";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const quickActions = [
  { label: "Messages", icon: MessageSquare, path: "/hub/chats", color: "bg-blue-500/10 text-blue-600" },
  { label: "Tickets", icon: ClipboardList, path: "/hub/tickets", color: "bg-primary/10 text-primary" },
  { label: "Phone", icon: Phone, path: "/hub/call", color: "bg-emerald-500/10 text-emerald-600" },
  { label: "Voicemails", icon: AudioWaveform, path: "/hub/voicemails", color: "bg-purple-500/10 text-purple-600" },
  { label: "Clients", icon: Users, path: "/hub/clients", color: "bg-amber-500/10 text-amber-600" },
  { label: "Templates", icon: FileText, path: "/hub/tools/templates", color: "bg-slate-500/10 text-slate-600" },
  { label: "Campaigns", icon: Megaphone, path: "/hub/tools/campaigns", color: "bg-rose-500/10 text-rose-600" },
  { label: "Surveys", icon: BarChart3, path: "/hub/tools/surveys", color: "bg-teal-500/10 text-teal-600" },
];

export default function HubHomePage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {getGreeting()}, {profile?.first_name || "there"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          The Living Room Vet — Staff Communications Hub
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickActions.map((action) => (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 min-h-[80px] hover:shadow-md hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 active:scale-95"
            >
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-full", action.color.split(" ")[0])}>
                <action.icon className={cn("h-5 w-5", action.color.split(" ")[1])} />
              </div>
              <span className="text-xs font-semibold text-foreground">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Hub features are being connected. Data from conversations, tickets, calls, and more will appear here as each module is wired up in upcoming phases.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
