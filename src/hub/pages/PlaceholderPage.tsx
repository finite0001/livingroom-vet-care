import { useLocation } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

export default function PlaceholderPage() {
  const location = useLocation();
  const pageName = location.pathname.split("/").filter(Boolean).pop() || "Page";
  const title = pageName.charAt(0).toUpperCase() + pageName.slice(1).replace(/-/g, " ");
  usePageTitle(title);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{title}</h1>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 p-12">
          <Construction className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <p className="text-base font-medium text-foreground">Coming Soon</p>
            <p className="text-sm text-muted-foreground mt-1">
              This feature will be ported from VET Connect Hub in the next phase.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
