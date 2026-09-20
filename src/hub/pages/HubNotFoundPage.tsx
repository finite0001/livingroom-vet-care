import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

/**
 * 404 *inside* the hub shell. The marketing NotFound page renders the public
 * header and footer, so a stale hub bookmark used to throw staff out of the
 * practice system and onto the public site. This page keeps the sidebar, the
 * header and the staff session, and offers the way back to the hub.
 */
export default function HubNotFoundPage() {
  const location = useLocation();
  usePageTitle("Page not found");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center px-4 py-20 text-center">
      <Compass className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="font-heading text-4xl font-bold text-primary">404</p>
      <h1 className="mt-3 text-xl font-bold text-foreground">We could not find that page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="break-all font-mono text-xs">{location.pathname}</span> is not a page in the practice hub. A
        bookmark or an emailed link may be out of date.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link to="/hub">Back to the hub</Link>
        </Button>
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Go back
        </Button>
      </div>
    </div>
  );
}
