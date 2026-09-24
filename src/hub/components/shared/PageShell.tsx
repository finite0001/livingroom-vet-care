import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * Standard outer container for a hub page: consistent padding and spacing.
 */
export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6", className)}>
      {children}
    </div>
  );
}
