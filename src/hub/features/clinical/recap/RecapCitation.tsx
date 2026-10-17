import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { patientHref } from "@/hub/features/patient-360/model";
import { readRecapCitation } from "./api";
import { RecapFeedback } from "./RecapFeedback";
import {
  RecapCurrentStatus,
  SourceContent,
  SourceSummary,
} from "./RecapSourcePreview";
import type { JobRead } from "./model";
interface RecapCitationProps {
  actor: string;
  job: JobRead;
  citation: { source_ref?: string; field_path?: string; quote?: string };
}
export function RecapCitation({ actor, job, citation }: RecapCitationProps) {
  const [value, setValue] = useState<Awaited<
      ReturnType<typeof readRecapCitation>
    > | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    lock = useRef(false);
  const captured = job.manifest.source_set.sources.find(
    (source) => source.ref === citation.source_ref,
  );
  async function open() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setValue(null);
    try {
      if (!citation.source_ref || !citation.field_path || !citation.quote)
        throw Error();
      const result = await readRecapCitation(actor, job, citation.source_ref);
      const key = citation.field_path.replace(/^fields\./, "");
      const text = result.source.fields[key];
      if (typeof text !== "string" || !text.includes(citation.quote))
        throw Error();
      setValue(result);
      requestAnimationFrame(() => panel.current?.focus());
    } catch (failure) {
      setError(failure);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="min-w-0 space-y-2">
      {captured && (
        <p className="break-words text-xs text-muted-foreground">
          <SourceSummary source={captured} />
        </p>
      )}
      <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-muted-foreground">
        {citation.quote}
      </blockquote>
      <Button
        ref={trigger}
        variant="outline"
        className="h-auto min-h-11 max-w-full whitespace-normal"
        disabled={busy}
        onClick={() => void open()}
      >
        {busy
          ? "Checking citation access…"
          : `Open frozen citation ${citation.source_ref} · ${citation.field_path}`}
      </Button>
      <RecapFeedback error={error} />
      {value && (
        <div
          ref={panel}
          tabIndex={-1}
          aria-label="Captured citation source"
          className="min-w-0 space-y-3 rounded-md border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <h5 className="font-medium">
            Captured source — not the current record
          </h5>
          <RecapCurrentStatus current={value.current} />
          <SourceContent
            source={value.source}
            fieldPath={citation.field_path}
            quote={citation.quote}
          />
          <p className="text-xs text-muted-foreground">
            All exact matching excerpts are highlighted. A citation verifies
            source membership, not medical correctness.
          </p>
          <details className="min-w-0 rounded-md border border-border p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">
              Source audit details
            </summary>
            <p className="break-all text-xs text-muted-foreground">
              Manifest {value.manifest_id} · {value.manifest_sha256} · source{" "}
              {value.source_ref} · field {citation.field_path}
            </p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
            >
              <Link to={patientHref(value.pet_id, "medical", "soap")}>
                Open current clinical workspace
              </Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setValue(null);
                trigger.current?.focus();
              }}
            >
              Close captured citation
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
