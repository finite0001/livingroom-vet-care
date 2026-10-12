import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { readReleaseScope } from "./release-scope-api";
interface Props {
  jobId: string;
  petId: string;
  actor: string;
  historical: boolean;
}
export function DiagnosticPdfReleaseScope({
  jobId,
  petId,
  actor,
  historical,
}: Props) {
  const [opened, setOpened] = useState(false),
    mode = historical ? "historical" : "current";
  const query = useQuery({
    queryKey: ["diagnostic-pdf-release-scope", actor, petId, jobId, mode],
    queryFn: () => readReleaseScope(jobId, petId, mode),
    enabled: opened,
  });
  return (
    <section aria-label="Diagnostic PDF sharing scope" className="space-y-2">
      <Button
        variant="outline"
        className="min-h-11"
        disabled={query.isFetching}
        onClick={() => {
          if (opened) void query.refetch();
          else setOpened(true);
        }}
      >
        {opened ? "Refresh sharing scope" : "Review sharing scope"}
      </Button>
      {opened && query.isPending ? (
        <p role="status">Checking the PDF's included records…</p>
      ) : opened && query.isError ? (
        <p role="alert">
          Sharing scope could not be verified. Refresh PDF status and try again.
        </p>
      ) : opened && query.data ? (
        <>
          <p className="font-medium">
            {historical ? "Historical PDF" : "Current reviewed PDF"} · Version{" "}
            {query.data.version}
          </p>
          <p className="text-sm">
            This PDF contains {query.data.embedded_versions.length} reviewed
            diagnostic{" "}
            {query.data.embedded_versions.length === 1 ? "panel" : "panels"},
            including the results and comparable trends below.
          </p>
          {query.data.total_panels > query.data.embedded_versions.length && (
            <p className="text-sm">
              The PDF includes a limited history:{" "}
              {query.data.embedded_versions.length} of {query.data.total_panels}{" "}
              panels available at its review time.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {query.data.embedded_versions.map((v) => (
              <li key={v.id} className="break-words">
                {v.label} · Version {v.version} · Reviewed{" "}
                {new Date(v.reviewed_at).toLocaleDateString()}
                {v.id === jobId ? " · Selected report" : ""}
              </li>
            ))}
          </ul>
          {query.data.scope_expansion_required && (
            <p className="text-sm font-medium">
              Sharing this PDF would also disclose the other listed panels. That
              additional scope must be reviewed before inclusion in a record
              package.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Sharing is awaiting record-package integration. This review does not
            authorize sending records.
          </p>
        </>
      ) : null}
    </section>
  );
}
