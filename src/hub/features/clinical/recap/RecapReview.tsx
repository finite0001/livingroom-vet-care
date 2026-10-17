import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recapReviewRequestSchema, type JobRead } from "./model";
import { z } from "zod";
import { RecapCitation } from "./RecapCitation";
import { formatDateTime } from "@/hub/features/patient-360/model";
interface RecapReviewProps {
  actor: string;
  job: JobRead;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (request: z.infer<typeof recapReviewRequestSchema>) => void;
}
export function RecapReview({
  actor,
  job,
  blocked,
  onDirtyChange,
  onSubmit,
}: RecapReviewProps) {
  const prefix = useId();
  const [chosen, setChosen] = useState<string[]>([]),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [note, setNote] = useState(""),
    [attested, setAttested] = useState(false),
    [formError, setFormError] = useState("");
  const output = job.output,
    review = job.review;
  const dirty = !!(
    chosen.length ||
    Object.keys(edits).length ||
    note ||
    attested
  );
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  if (!output) return null;
  const canAccept =
    job.current.source_status === "current" &&
    job.policy.status === "approved" &&
    job.policy.version === job.job.policy_version;
  function submit(decision: "accepted" | "rejected") {
    const input = recapReviewRequestSchema.safeParse({
      job_id: job.job.id,
      output_id: output!.id,
      expected_output_hash: output!.payload_sha256,
      expected_review_version: job.job.review_version,
      manifest_sha256: job.manifest.sha256,
      decision,
      accepted_claims:
        decision === "accepted"
          ? output!.payload.claims
              .filter((claim) => chosen.includes(claim.claim_id))
              .map((claim) => ({
                claim_id: claim.claim_id,
                text: edits[claim.claim_id] ?? claim.text,
              }))
          : [],
      review_note: note,
      attest_reviewed: attested,
    });
    if (!input.success) {
      setFormError(
        "Review the selected claims, wording and required attestation before continuing. Rejection requires a reason.",
      );
      return;
    }
    setFormError("");
    onSubmit(input.data);
  }
  return (
    <section
      aria-label="Recap claim review"
      className="min-w-0 space-y-4 border-t border-border pt-4"
    >
      <h4 className="font-display text-lg">
        {review ? "Immutable reviewed recap" : "Review generated recap claims"}
      </h4>
      <p className="text-sm text-muted-foreground">
        Review each dated claim against every cited frozen source. A recap is a
        summary of selected records, not a complete or current chart. Accepting
        retains an internal recap without changing any encounter, problem,
        signature or communication.
      </p>
      {output.payload.review_flags.length > 0 && (
        <div
          role="note"
          className="space-y-1 rounded-md border border-border p-3"
        >
          <h5 className="font-medium">Needs reviewer attention</h5>
          {output.payload.review_flags.map((flag, i) => (
            <p key={i} className="whitespace-pre-wrap break-words text-sm">
              {flag}
            </p>
          ))}
        </div>
      )}
      {review && (
        <section className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm">
            Decision: {review.decision} · reviewed{" "}
            {formatDateTime(review.created_at)} (Denver)
          </p>
          <p className="whitespace-pre-wrap break-words text-sm">
            {review.review_note}
          </p>
          <p className="text-xs text-muted-foreground">
            The model wording, citations and reviewer wording remain separate.
            Corrections require a new linked recap.
          </p>
        </section>
      )}
      <details className="min-w-0 rounded-md border border-border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Recap audit details
        </summary>
        <div className="min-w-0 space-y-2 text-xs text-muted-foreground">
          <p className="break-all">
            Output {output.id} · SHA256 {output.payload_sha256} · manifest{" "}
            {output.manifest_sha256} · exact output time {output.created_at}
          </p>
          <p className="break-words">
            Model: {output.provider_manifest.provider_model} · prompt{" "}
            {output.provider_manifest.prompt_version} · veterinary vocabulary{" "}
            {output.provider_manifest.language_context.version}
          </p>
          {review && (
            <p className="break-all">
              Review {review.id} · job {review.job_id} · reviewer{" "}
              {review.reviewer_id} · exact review time {review.created_at} ·
              version {review.version}
            </p>
          )}
        </div>
      </details>
      {review && dirty && (
        <section
          aria-label="Unsaved local recap review"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <h5 className="font-medium">
            Your local review wording is retained separately
          </h5>
          <p className="text-sm">
            A terminal review is now present. Your earlier unsaved text has not
            replaced it.
          </p>
          {Object.entries(edits).map(([id, text]) => (
            <p key={id} className="whitespace-pre-wrap break-words text-sm">
              {id}: {text}
            </p>
          ))}
          <p className="whitespace-pre-wrap break-words text-sm">{note}</p>
          <Button
            variant="outline"
            disabled={blocked}
            onClick={() => {
              setChosen([]);
              setEdits({});
              setNote("");
              setAttested(false);
            }}
          >
            Discard unsaved local recap review
          </Button>
        </section>
      )}
      {output.payload.claims.map((claim) => {
        const retained = review?.accepted_claims.find(
          (item) => item.claim_id === claim.claim_id,
        );
        return (
          <article
            key={claim.claim_id}
            aria-label={`Recap claim ${claim.claim_id}`}
            className="min-w-0 space-y-3 rounded-lg border border-border bg-background p-3"
          >
            <h5 className="break-words font-medium">
              {claim.claim_id} · {claim.category.replace(/_/g, " ")} ·{" "}
              {claim.temporal_status.replace(/_/g, " ")}
            </h5>
            <p className="whitespace-pre-wrap break-words text-sm">
              Proposed: {claim.text}
            </p>
            {claim.uncertainty && (
              <p
                role="note"
                className="whitespace-pre-wrap break-words text-sm"
              >
                Uncertainty: {claim.uncertainty}
              </p>
            )}
            {claim.temporal_status === "recorded_status_as_of_capture" && (
              <p className="text-xs text-muted-foreground">
                Recorded native problem status as of capture; this does not
                establish a current confirmed diagnosis.
              </p>
            )}
            {claim.citations.map((citation, i) => (
              <RecapCitation
                key={i}
                actor={actor}
                job={job}
                citation={citation}
              />
            ))}
            {review ? (
              retained ? (
                <p className="whitespace-pre-wrap break-words text-sm font-medium">
                  Reviewed wording: {retained.reviewed_text}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not retained in this review.
                </p>
              )
            ) : (
              <fieldset disabled={blocked} className="space-y-2">
                <legend className="sr-only">Review {claim.claim_id}</legend>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.includes(claim.claim_id)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, claim.claim_id]
                          : chosen.filter((id) => id !== claim.claim_id),
                      )
                    }
                  />
                  Retain {claim.claim_id}
                </label>
                <Label htmlFor={`${prefix}-${claim.claim_id}`}>
                  Reviewed wording for {claim.claim_id}
                </Label>
                <Textarea
                  id={`${prefix}-${claim.claim_id}`}
                  rows={3}
                  maxLength={500}
                  value={edits[claim.claim_id] ?? claim.text}
                  onChange={(e) =>
                    setEdits({ ...edits, [claim.claim_id]: e.target.value })
                  }
                />
              </fieldset>
            )}
          </article>
        );
      })}
      {!review && (
        <fieldset disabled={blocked} className="space-y-3">
          <legend className="font-medium">Explicit review decision</legend>
          {!canAccept && (
            <p role="status" className="text-sm">
              Acceptance is unavailable because sources or policy changed. You
              can reject with a reason; historical evidence remains retained.
            </p>
          )}
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <Label htmlFor={`${prefix}-note`}>
            Review note (required for rejection)
          </Label>
          <Textarea
            id={`${prefix}-note`}
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            I reviewed the patient attribution, dated claims, wording and all
            supporting citations.
          </label>
          {chosen.length > 0 && (
            <details className="min-w-0 rounded-md border border-border p-3">
              <summary className="min-h-11 cursor-pointer font-medium">
                Preview selected reviewed wording ({chosen.length})
              </summary>
              {output.payload.claims
                .filter((claim) => chosen.includes(claim.claim_id))
                .map((claim) => (
                  <p
                    key={claim.claim_id}
                    className="mb-2 whitespace-pre-wrap break-words text-sm"
                  >
                    {claim.claim_id}: {edits[claim.claim_id] ?? claim.text}
                  </p>
                ))}
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={!canAccept || !attested || !chosen.length}
              onClick={() => submit("accepted")}
            >
              Retain selected claims as reviewed recap
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={!attested || !note.trim()}
              onClick={() => submit("rejected")}
            >
              Reject recap
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This decision retains only an internal recap. Signing, chart
            updates, export and delivery are separate workflows and are not part
            of this action.
          </p>
        </fieldset>
      )}
    </section>
  );
}
