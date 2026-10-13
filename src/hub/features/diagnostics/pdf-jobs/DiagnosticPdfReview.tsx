import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import { DiagnosticPdfReleaseScope } from "./DiagnosticPdfReleaseScope";
import { downloadPdf, readPdfReview } from "./review-api";
interface Props {
  jobId: string;
  petId: string;
  loadOnDemand?: boolean;
}
const messages = {
  off: "PDF preparation is off.",
  waiting: "PDF is waiting for preparation.",
  preparing: "PDF preparation is in progress.",
  failed:
    "PDF preparation failed. Contact support; the reviewed results are retained.",
  stored_private: "Verified PDF stored privately.",
  unavailable:
    "The registered PDF file is unavailable. Contact support; report history is retained.",
};
export function DiagnosticPdfReview({ jobId, petId, loadOnDemand }: Props) {
  const { session, profile } = useAuth();
  const actor = session?.user.id;
  return actor && profile?.is_active ? (
    <Review
      key={`${actor}:${petId}:${jobId}`}
      jobId={jobId}
      petId={petId}
      actor={actor}
      loadOnDemand={loadOnDemand}
    />
  ) : null;
}
interface ReviewProps extends Props {
  actor: string;
}
function Review({ jobId, petId, actor, loadOnDemand }: ReviewProps) {
  const [requested, setRequested] = useState(!loadOnDemand);
  const query = useQuery({
    queryKey: ["diagnostic-pdf-review", actor, petId, jobId],
    queryFn: () => readPdfReview(jobId, petId),
    enabled: requested,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function download() {
    if (locked.current || !query.data) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const blob = await downloadPdf(query.data, actor);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `diagnostic-${jobId}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (alive.current) {
        setError(
          "PDF download could not be verified. Refresh its status and try again.",
        );
        void query.refetch();
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Diagnostic PDF"
      className="space-y-2 rounded-md border border-border bg-background p-3"
    >
      {!requested ? (
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setRequested(true)}
        >
          Check this report's PDF
        </Button>
      ) : query.isPending ? (
        <p role="status">Checking PDF status…</p>
      ) : query.isError ? (
        <p role="alert">PDF status could not be loaded.</p>
      ) : !query.data ? (
        <p>PDF unavailable for this reviewed version.</p>
      ) : (
        <>
          <p>{messages[query.data.state]}</p>
          <p className="text-sm text-muted-foreground">
            {query.data.historical ? "Historical report" : "Reviewed report"} ·
            Version {query.data.version}
          </p>
          {query.data.state === "stored_private" &&
            !query.data.download_available && (
              <p className="text-sm">Staff PDF downloads are off.</p>
            )}
          {query.data.state === "stored_private" && (
            <DiagnosticPdfReleaseScope
              jobId={jobId}
              petId={petId}
              actor={actor}
              historical={query.data.historical}
            />
          )}
          {query.data.download_available && (
            <Button
              className="min-h-11"
              disabled={busy}
              onClick={() => void download()}
            >
              {busy ? "Verifying PDF…" : "Download verified PDF"}
            </Button>
          )}
        </>
      )}
      {requested && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={busy || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh PDF status
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="text-sm text-muted-foreground">
        Excluded from outgoing record packages until record sharing is
        available.
      </p>
    </section>
  );
}
