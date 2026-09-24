import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { renderRecordRelease, type ReleaseArtifact } from "./print";
interface RecordReleaseArtifactProps {
  artifact: ReleaseArtifact;
  refreshConfirmed?: () => Promise<ReleaseArtifact>;
}
/** Read-only review artifact. Parent obtains preview/current package status from authorized RPCs. */
export function RecordReleaseArtifact({
  artifact,
  refreshConfirmed,
}: RecordReleaseArtifactProps) {
  const html = useMemo(() => renderRecordRelease(artifact), [artifact]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saveHtml = async () => {
    setBusy(true);
    setError("");
    try {
      if (artifact.confirmed && !refreshConfirmed)
        throw new Error("Refresh confirmed package status before exporting.");
      const current = artifact.confirmed ? await refreshConfirmed!() : artifact;
      const exportHtml = renderRecordRelease(current);
      const url = URL.createObjectURL(
        new Blob([exportHtml], { type: "text/html;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `medical-records-${current.confirmed?.id || current.preview.source_hash.slice(0, 12)}.html`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as { message?: string })?.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3" aria-label="Medical-record release review">
      <p className="text-sm text-muted-foreground">
        Review the complete document below. Original attachments are listed
        separately and are not embedded in this HTML export.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button variant="outline" disabled={busy} onClick={() => void saveHtml()}>
        Save review HTML
      </Button>
      <iframe
        title="Medical-record release artifact"
        sandbox=""
        srcDoc={html}
        className="h-[70vh] w-full rounded-md border bg-background"
      />
    </section>
  );
}
