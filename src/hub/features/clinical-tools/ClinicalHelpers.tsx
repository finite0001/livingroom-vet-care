import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { WorkforceForm, type FormField } from "../workforce/WorkforceForm";
import { clinicalCall, clinicalToolsSchema, generateHelper } from "./api";
import { labValueSchema } from "../../../../supabase/functions/_shared/clinical-helper-contract";
interface ClinicalHelpersProps {
  kind: "discharge" | "bloodwork" | "pill";
  data: z.infer<typeof clinicalToolsSchema>;
  pet: string | null;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function ClinicalHelpers({
  kind,
  data,
  pet,
  disabled,
  onDirtyChange,
}: ClinicalHelpersProps) {
  const cache = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [labs, setLabs] = useState([
    { analyte: "", value: "", unit: "", reference_range: "" },
  ]);
  const [review, setReview] = useState<{ id: string; text: string } | null>(
    null,
  );
  useEffect(() => {
    onDirtyChange(Boolean(review));
    return () => onDirtyChange(false);
  }, [review, onDirtyChange]);
  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["clinical-tools"] });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft action failed");
      await cache.invalidateQueries({ queryKey: ["clinical-tools"] });
      return false;
    } finally {
      setPending(false);
    }
  }
  const fields: FormField[] =
    kind === "pill"
      ? [
          { name: "imprint", label: "Known imprint (exact letters/numbers)" },
          { name: "shape", label: "Shape (optional)", optional: true },
          { name: "color", label: "Color (optional)", optional: true },
        ]
      : [
          {
            name: "encounter_id",
            label: "Signed encounter",
            options: data.encounters.map((e) => ({
              value: e.id,
              label: `${new Date(e.visit_at).toLocaleDateString("en-US", { timeZone: "America/Denver" })} · ${e.assessment}`,
            })),
          },
          ...(kind === "bloodwork"
            ? [
                {
                  name: "lab_id",
                  label: "Patient lab record",
                  options: data.labs.map((l) => ({
                    value: l.id,
                    label: `${l.test_name} · ${l.result_date}`,
                  })),
                },
                {
                  name: "attest_reviewed",
                  label:
                    "I verified entered values, units and ranges against this report",
                  type: "checkbox" as const,
                },
              ]
            : []),
        ];
  return (
    <section className="space-y-4">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {kind === "pill" && (
        <p className="rounded border p-3 text-sm">
          Matches are limited to veterinarian-verified catalog records. No
          imprint or no verified match means unable to identify. Confirm
          identity against the original labeled container or a pharmacist before
          any use.
        </p>
      )}
      {!pet ? (
        <p>
          Choose a patient above to select clinical sources and save drafts.
        </p>
      ) : disabled ? (
        <p>Protocol approval is needed before generating a draft.</p>
      ) : (
        <>
          {kind === "bloodwork" && (
            <fieldset className="space-y-3 rounded border p-4">
              <legend className="px-2 font-medium">
                Verified report values
              </legend>
              <p className="text-sm text-muted-foreground">
                Copy exact report values, units and reference ranges; use “not
                provided” when the source has no range. Do not infer one.
              </p>
              {labs.map((row, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-4">
                  {(
                    ["analyte", "value", "unit", "reference_range"] as const
                  ).map((key) => (
                    <label key={key} className="text-sm">
                      {key.replace(/_/g, " ")} {index + 1}
                      <input
                        value={row[key]}
                        className="mt-1 w-full rounded border bg-background p-2"
                        onChange={(e) => {
                          onDirtyChange(true);
                          setLabs((old) =>
                            old.map((v, n) =>
                              n === index ? { ...v, [key]: e.target.value } : v,
                            ),
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
              ))}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={labs.length >= 100}
                  onClick={() =>
                    setLabs((old) => [
                      ...old,
                      { analyte: "", value: "", unit: "", reference_range: "" },
                    ])
                  }
                >
                  Add test
                </Button>
                {labs.length > 1 && (
                  <Button
                    variant="ghost"
                    onClick={() => setLabs((old) => old.slice(0, -1))}
                  >
                    Remove last test
                  </Button>
                )}
              </div>
            </fieldset>
          )}
          <WorkforceForm
            title={`Generate ${kind === "discharge" ? "discharge instructions" : kind === "bloodwork" ? "bloodwork explanation" : "pill candidate review"}`}
            fields={fields}
            pending={pending}
            onDirtyChange={onDirtyChange}
            button="Generate cited draft"
            description="Generation does not sign, send or approve anything. Review the saved job before retrying a failed request."
            submit={(v, requestId) => {
              const selection =
                kind === "bloodwork"
                  ? {
                      ...v,
                      lab_values: z.array(labValueSchema).min(1).parse(labs),
                    }
                  : v;
              return run(() =>
                generateHelper({
                  id: requestId,
                  pet_id: pet,
                  kind,
                  data: selection,
                }),
              );
            }}
          />
        </>
      )}
      {data.helpers
        .filter((j) => j.kind === kind)
        .map((j) => (
          <article
            key={j.id}
            className="space-y-3 rounded-xl border bg-card p-4"
          >
            <h2 className="font-display text-lg">
              {kind} · {j.state.toLowerCase()}
            </h2>
            <p className="text-xs text-muted-foreground">
              Created{" "}
              {new Date(j.created_at).toLocaleString("en-US", {
                timeZone: "America/Denver",
              })}
            </p>
            {j.state === "GENERATING" && (
              <p role="status">
                Generation is pending. Refresh this saved job before starting
                another draft.
              </p>
            )}
            {j.failure && <p>No usable draft saved ({j.failure}).</p>}
            {j.result?.claims.map((claim, index) => (
              <div key={index}>
                <p>{claim.text}</p>
                <details className="text-xs text-muted-foreground">
                  <summary>Source evidence</summary>
                  {claim.citations.map((c, n) => (
                    <p key={n} className="break-words">
                      Source {c.source_ref}: “{c.quote}”
                    </p>
                  ))}
                </details>
              </div>
            ))}
            {j.result?.review_flags.map((flag) => (
              <p key={flag} className="text-sm text-destructive">
                Review: {flag}
              </p>
            ))}
            {j.reviewed_text && (
              <div className="space-y-2">
                <h3 className="font-medium">Veterinarian-approved text</h3>
                <p className="whitespace-pre-wrap">{j.reviewed_text}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run(() =>
                      navigator.clipboard.writeText(j.reviewed_text!),
                    )
                  }
                >
                  Copy approved text for message composer
                </Button>
              </div>
            )}
            {j.state === "GENERATED" &&
              data.can_review &&
              (review?.id === j.id ? (
                <div className="space-y-3">
                  <label className="block text-sm">
                    Review and edit every statement
                    <textarea
                      className="mt-2 min-h-48 w-full rounded border bg-background p-3"
                      value={review.text}
                      onChange={(e) =>
                        setReview({ id: j.id, text: e.target.value })
                      }
                    />
                  </label>
                  <div className="flex gap-3">
                    <Button
                      disabled={pending}
                      onClick={() =>
                        void run(async () => {
                          await clinicalCall("review_clinical_helper", {
                            p_id: j.id,
                            p_text: review.text,
                          });
                          setReview(null);
                        })
                      }
                    >
                      Approve reviewed artifact
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => setReview(null)}
                    >
                      Discard edits
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={pending}
                  onClick={() =>
                    setReview({
                      id: j.id,
                      text:
                        j.result?.claims.map((c) => c.text).join("\n\n") ?? "",
                    })
                  }
                >
                  Start veterinarian review
                </Button>
              ))}
          </article>
        ))}
      {kind === "pill" && data.can_review && (
        <WorkforceForm
          title="Add a verified pill reference"
          description="Enter an authoritative licensed source and verify the exact formulation. New references do not automatically identify or authorize a medication."
          pending={pending}
          fields={[
            { name: "name", label: "Medication / product name" },
            { name: "strength", label: "Verified strength and formulation" },
            { name: "imprint", label: "Exact imprint" },
            { name: "shape", label: "Shape" },
            { name: "color", label: "Color" },
            { name: "source_url", label: "Authoritative source URL (HTTPS)" },
          ]}
          submit={(v) => {
            const input = z
              .object({
                name: z.string().trim().min(1).max(200),
                strength: z.string().trim().min(1).max(100),
                imprint: z.string().trim().min(1).max(100),
                shape: z.string().trim().min(1).max(100),
                color: z.string().trim().min(1).max(100),
                source_url: z.url().startsWith("https://").max(2000),
              })
              .parse(v);
            return run(() =>
              clinicalCall("add_pill_reference", {
                p_id: crypto.randomUUID(),
                p_values: input,
              }),
            );
          }}
        />
      )}
    </section>
  );
}
