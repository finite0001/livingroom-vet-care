import { useQuery } from "@tanstack/react-query";
import { Syringe } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusToneClass, type StatusTone } from "@/hub/components/shared/StatusChip";
import { useAppSettings } from "@/hub/hooks/use-app-settings";
import { readVaccineStatus } from "./api";
import {
  DUE_SOON_DEFAULT_REVIEW_NOTE,
  DUE_SOON_SETTING_KEY,
  dueDescription,
  dueSoonWindow,
  dueStateLabel,
  flagLabel,
  sourceLabel,
  vaccineStatusRows,
  type VaccineDueState,
} from "./vaccine-status";

interface PatientVaccineStatusProps {
  petId: string;
}
const stateTone: Record<VaccineDueState, StatusTone> = {
  overdue: "destructive",
  due_soon: "warning",
  current: "success",
  no_due_date: "neutral",
};

/** Read-only summary; every date shown comes from a recorded or reviewed source. */
export function PatientVaccineStatus({ petId }: PatientVaccineStatusProps) {
  const settings = useAppSettings();
  const status = useQuery({
    queryKey: ["vaccine-status", petId],
    queryFn: () => readVaccineStatus(petId),
  });
  const dueWindow = dueSoonWindow(settings.data?.[DUE_SOON_SETTING_KEY]);
  if (status.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading vaccine status…
      </p>
    );
  if (status.isError)
    return (
      <div role="alert" className="text-sm text-destructive">
        Vaccine status could not be loaded.{" "}
        <button className="underline" onClick={() => void status.refetch()}>
          Retry
        </button>
      </div>
    );
  const rows = vaccineStatusRows(status.data, dueWindow.days);
  return (
    <section
      aria-label="Vaccine status"
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <Syringe className="h-5 w-5 text-primary" aria-hidden="true" />
          Vaccine status
        </h2>
        <p className="text-xs text-muted-foreground">
          As of {status.data.as_of} · due soon = within {dueWindow.days} days
          {dueWindow.configured ? " (practice setting)" : ` · ${DUE_SOON_DEFAULT_REVIEW_NOTE}`}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No vaccine administrations or due plans are recorded for this patient.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {rows.map((row) => (
            <li
              key={row.group_key}
              className="min-w-0 rounded-md border p-3"
              data-state={row.state}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-medium">
                  {row.group_name}
                </h3>
                <span
                  className={cn(
                    "status-chip shrink-0",
                    statusToneClass[stateTone[row.state]],
                  )}
                >
                  {dueStateLabel[row.state]}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Last given</dt>
                  <dd className="break-words">
                    {row.last_given_on ?? "Not recorded"}
                    <span className="block text-xs text-muted-foreground">
                      {row.last_given_source
                        ? sourceLabel[row.last_given_source]
                        : ""}
                      {row.last_product_name ? ` · ${row.last_product_name}` : ""}
                    </span>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Next due</dt>
                  <dd className="break-words">
                    {row.due_on ?? "No due date"}
                    {row.due_on && (
                      <span className="block text-xs text-muted-foreground">
                        {dueDescription(row)}
                      </span>
                    )}
                    {row.due_source && (
                      <span className="block text-xs text-muted-foreground">
                        Source: {sourceLabel[row.due_source]}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {row.flags.map((flag) => (
                <p key={flag} role="note" className="mt-2 text-xs text-clinical-alert">
                  {flagLabel[flag]}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        A current reviewed due plan wins over dates recorded on individual
        administrations. Proposed plans never supply a date. Corrected records
        are excluded. Review full history below before deciding a schedule.
      </p>
    </section>
  );
}
