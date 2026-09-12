import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { renderRecordRelease, type ReleaseArtifact } from "./print";
interface RecordReleaseArtifactProps {
  artifact: ReleaseArtifact;
}
/** Read-only review artifact. Parent obtains preview/current package status from authorized RPCs. */
export function RecordReleaseArtifact({
  artifact,
}: RecordReleaseArtifactProps) {
  const html = useMemo(() => renderRecordRelease(artifact), [artifact]);
  const saveHtml = () => {
    const url = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `medical-records-${artifact.confirmed?.id || artifact.preview.source_hash.slice(0, 12)}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="space-y-3" aria-label="Medical-record release review">
      <p className="text-sm text-muted-foreground">
        Review the complete document below. Original attachments are listed
        separately and are not embedded in this HTML export.
      </p>
      <Button variant="outline" onClick={saveHtml}>
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
