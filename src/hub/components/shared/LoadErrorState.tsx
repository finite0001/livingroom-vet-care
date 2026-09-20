import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LoadErrorStateProps {
  /** What failed to load, e.g. "Tickets" or "Your recent shifts". */
  label: string;
  /** A more specific sentence, when the caller has one worth showing. */
  detail?: string;
  /** When given, the state offers a retry button. */
  onRetry?: () => void;
  className?: string;
}

/**
 * A load *error* state, deliberately different from an empty state. When a read
 * fails, an empty state tells the clinic "there is nothing here", which is a
 * different and much more dangerous statement than "we could not load this".
 * Every list that can fail to load gets this instead of its empty state.
 */
export function LoadErrorState({ label, detail, onRetry, className }: LoadErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-4 py-16 text-center", className)}>
      <AlertTriangle className="mb-3 h-10 w-10 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium">{label} could not be loaded.</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {detail ?? "Nothing has been lost. The page could not reach the server — check the connection and try again."}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}
