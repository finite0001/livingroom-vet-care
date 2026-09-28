import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NextStep } from "./model";

const VISIBLE = 4;

const PRIORITY_META: Record<NextStep["priority"], { label: string; tone: string; icon: typeof AlertTriangle }> = {
  urgent: { label: "Needs attention", tone: "tone-destructive", icon: AlertTriangle },
  soon: { label: "Follow up", tone: "tone-warning", icon: Clock },
  info: { label: "Coming up", tone: "tone-info", icon: CalendarClock },
};

interface NextSteps360Props {
  steps: NextStep[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

/** "Needs attention / next steps" strip; each item links to where it is resolved. */
export function NextSteps360({ steps, loading, error, onRetry }: NextSteps360Props) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? steps ?? [] : (steps ?? []).slice(0, VISIBLE);
  const hidden = (steps?.length ?? 0) - shown.length;
  return (
    <section aria-labelledby="next-steps-heading" className="rounded-2xl border bg-card p-4 shadow-card md:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="next-steps-heading" className="font-display text-lg">Next steps</h2>
        {steps && steps.length > 0 && <span className="text-xs text-muted-foreground">{steps.length} item{steps.length === 1 ? "" : "s"}</span>}
      </div>
      {loading ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">Checking what needs attention…</p>
      ) : error ? (
        <div role="alert" className="mt-2 text-sm">
          Next steps could not be loaded. The sections below still work.{" "}
          <Button variant="link" className="h-auto p-0" onClick={onRetry}>Retry</Button>
        </div>
      ) : !steps || steps.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> Nothing needs attention right now.
        </p>
      ) : (
        <>
          <ul className="mt-3 grid gap-2 md:grid-cols-2" aria-label="Next steps">
            {shown.map((step) => {
              const meta = PRIORITY_META[step.priority];
              const Icon = meta.icon;
              return (
                <li key={step.id}>
                  <Link
                    to={step.href}
                    data-priority={step.priority}
                    className="group flex h-full min-h-[44px] items-start gap-3 rounded-xl border bg-background p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", meta.tone)}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">{meta.label}: </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                      <span className="block text-xs text-muted-foreground">{step.detail}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-terracotta-dark group-hover:underline">
                        {step.actionLabel} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {(hidden > 0 || expanded) && (
            <Button variant="ghost" size="sm" className="mt-2" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show fewer" : `Show ${hidden} more`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
