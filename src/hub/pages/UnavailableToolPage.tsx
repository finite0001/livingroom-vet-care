import { Link, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { usePageTitle } from "@/hooks/use-page-title";

interface ToolDescription {
  name: string;
  description: string;
}
const tools: Record<string, ToolDescription> = {
  "/hub/tools/campaigns": {
    name: "Campaigns",
    description: "Campaign delivery is not available in this workspace.",
  },
  "/hub/tools/alerts": {
    name: "Broadcast messages",
    description:
      "Broadcast delivery is not available. Clinical alerts remain available in each patient record.",
  },
  "/hub/tools/surveys": {
    name: "Surveys",
    description:
      "Survey delivery and response collection are not available in this workspace.",
  },
  "/hub/call": {
    name: "Voice calling",
    description: "Voice calling is not available in this workspace.",
  },
  "/hub/voicemails": {
    name: "Voicemail",
    description:
      "Voicemail collection and playback are not available in this workspace.",
  },
  "/hub/admin/import": {
    name: "Legacy CSV import",
    description:
      "This importer is unavailable. Administrators can use the reviewed ezyVet import workflow for supported records.",
  },
};

export default function UnavailableToolPage() {
  const { pathname } = useLocation();
  const tool = tools[pathname] ?? {
    name: "Tool",
    description: "This tool is unavailable.",
  };
  usePageTitle(`${tool.name} — unavailable`);
  return (
    <div className="p-4 md:p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <h1 className="text-xl font-semibold">{tool.name} — unavailable</h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>{tool.description}</p>
          <div className="flex flex-wrap gap-4">
            <Link className="text-primary underline" to="/hub/chats">
              Open inbox
            </Link>
            <Link
              className="text-primary underline"
              to="/hub/tools/care-reminders"
            >
              Open Care reminders
            </Link>
            {pathname === "/hub/admin/import" && (
              <Link className="text-primary underline" to="/hub/tools/ezyvet">
                Open reviewed ezyVet imports
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
