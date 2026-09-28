import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Section360Props {
  id: string;
  children: ReactNode;
  className?: string;
}

/** Deep-link target inside a 360 tab (`?tab=…&section=<id>`). */
export function Section360({ id, children, className }: Section360Props) {
  return (
    <div id={`p360-${id}`} tabIndex={-1} className={cn("scroll-mt-40 focus:outline-none", className)}>
      {children}
    </div>
  );
}
