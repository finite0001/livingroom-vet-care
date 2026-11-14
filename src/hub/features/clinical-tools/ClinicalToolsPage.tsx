import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { WorkforceForm, type FormField } from "../workforce/WorkforceForm";
import {
  calculate,
  references,
  TOOL_VERSION,
  type Calculation,
} from "./calculators";
import { clinicalCall, readClinicalTools } from "./api";
import { ClinicalHelpers } from "./ClinicalHelpers";
import { useUnsavedChanges } from "../clinical/use-unsaved-changes";
const toolNames: Record<string, string> = {
  fluid: "Fluid planning",
  shock: "Shock fluid bolus",
  chocolate: "Chocolate exposure",
  gestation: "Gestation",
  discharge: "Discharge drafts",
  bloodwork: "Bloodwork explanations",
  pill: "Pill identification",
};
const species: FormField = {
  name: "species",
  label: "Species",
  options: [
    { value: "dog", label: "Adult dog" },
    { value: "cat", label: "Adult cat" },
  ],
};
const weight: FormField[] = [
  { name: "weight", label: "Confirmed current weight", type: "number" },
  {
    name: "unit",
    label: "Weight unit",
    options: [
      { value: "kg", label: "kg" },
      { value: "lb", label: "lb" },
    ],
  },
];
export default function ClinicalToolsPage() {
  usePageTitle("Clinical tools");
  const [params, setParams] = useSearchParams();
  const { session } = useAuth();
  const cache = useQueryClient();
  const parsed = z.string().uuid().safeParse(params.get("pet"));
  const pet = parsed.success ? parsed.data : null;
  const [search, setSearch] = useState("");
  const [tool, setTool] = useState("fluid");
  const [result, setResult] = useState<Calculation | null>(null);
  const [inputs, setInputs] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const unsavedDialog = useUnsavedChanges(dirty);
  const query = useQuery({
    queryKey: ["clinical-tools", session?.user.id, pet],
    queryFn: () => readClinicalTools(pet),
    enabled: Boolean(session?.user.id),
  });
  const patients = useQuery({
    queryKey: ["clinical-tool-patient-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pets")
        .select("id,name,species")
        .ilike("name", `%${search.replace(/[%_]/g, "")}%`)
        .is("archived_at", null)
        .limit(25);
      if (error) throw error;
      return data;
    },
  });
  const d = query.data;
  const approved = d?.protocols.some(
    (p) => p.tool === tool && p.version === TOOL_VERSION,
  );
  async function action(fn: () => Promise<unknown>) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["clinical-tools"] });
      setNotice("Saved.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setPending(false);
    }
  }
  const fields: FormField[] =
    tool === "fluid"
      ? [
          species,
          ...weight,
          {
            name: "dehydration_percent",
            label: "Estimated dehydration (%)",
            type: "number",
          },
          {
            name: "replacement_hours",
            label: "Deficit replacement hours (12–24)",
            type: "number",
            value: 24,
          },
          {
            name: "ongoing_ml_hour",
            label: "Known ongoing losses (mL/hour)",
            type: "number",
            value: 0,
          },
        ]
      : tool === "shock"
        ? [species, ...weight]
        : tool === "chocolate"
          ? [
              ...weight,
              {
                name: "grams",
                label: "Estimated chocolate ingested (grams)",
                type: "number",
              },
              {
                name: "product",
                label: "Known product",
                options: [
                  { value: "cocoa", label: "Cocoa powder" },
                  { value: "baking", label: "Unsweetened baking chocolate" },
                  { value: "dark", label: "Semisweet / sweet dark" },
                  { value: "milk", label: "Milk chocolate" },
                  { value: "white", label: "White chocolate" },
                  { value: "percent", label: "Known labeled cocoa percentage" },
                ],
              },
              {
                name: "cocoa_percent",
                label: "Labeled cocoa % (only for percentage product)",
                type: "number",
                optional: true,
              },
            ]
          : [
              species,
              {
                name: "basis",
                label: "Known date type",
                options: [
                  { value: "ovulation", label: "Ovulation (dog)" },
                  { value: "breeding", label: "Breeding" },
                ],
              },
              { name: "date", label: "Date", type: "date" },
            ];
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      {unsavedDialog}
      <header>
        <h1 className="font-display text-2xl">Clinical tools</h1>
        <p className="text-sm text-muted-foreground">
          Reviewed calculations and source-linked draft helpers.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="font-display text-lg">Patient context</h2>
        {d?.patient && (
          <p>
            <strong>{d.patient.name}</strong> · {d.patient.species} ·{" "}
            <Link
              className="underline"
              to={`/hub/patient/${pet}?tab=medical&section=clinical-tools`}
            >
              Open patient chart
            </Link>
          </p>
        )}
        <label className="block text-sm">
          Find patient
          <input
            className="ml-2 rounded border bg-background p-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="At least 2 characters"
          />
        </label>
        {patients.isError && (
          <p role="alert">Patient search failed: {patients.error.message}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {patients.data?.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              size="sm"
              onClick={() => {
                if (dirty && !window.confirm("Discard the unsaved worksheet?"))
                  return;
                setParams({ pet: p.id });
                setResult(null);
                setDirty(false);
                setSearch("");
              }}
            >
              {p.name} · {p.species}
            </Button>
          ))}
        </div>
      </section>
      {query.isPending ? (
        <p>Loading clinical protocols…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        d && (
          <>
            <nav aria-label="Clinical tool" className="flex flex-wrap gap-2">
              {Object.entries(toolNames).map(([key, label]) => (
                <Button
                  key={key}
                  variant={tool === key ? "default" : "outline"}
                  aria-pressed={tool === key}
                  onClick={() => {
                    if (
                      dirty &&
                      !window.confirm("Discard the unsaved worksheet?")
                    )
                      return;
                    setTool(key);
                    setResult(null);
                    setDirty(false);
                  }}
                >
                  {label}
                </Button>
              ))}
            </nav>
            {!approved && (
              <p className="rounded border p-3 text-sm">
                Needs veterinary protocol review before clinical use.
                Veterinarians can preview reference cases and approve below.
              </p>
            )}
            {["fluid", "shock", "chocolate", "gestation"].includes(tool) ? (
              <>
                {(approved || d.can_review) && (
                  <WorkforceForm
                    key={tool}
                    title={toolNames[tool]}
                    onDirtyChange={setDirty}
                    description="Confirm current weight/units and clinical suitability. This worksheet does not prescribe or administer treatment."
                    fields={fields}
                    pending={pending}
                    button="Calculate worksheet"
                    submit={async (values) => {
                      const input = Object.fromEntries(
                        Object.entries(values).map(([k, v]) => [
                          k,
                          [
                            "weight",
                            "dehydration_percent",
                            "replacement_hours",
                            "ongoing_ml_hour",
                            "grams",
                            "cocoa_percent",
                          ].includes(k)
                            ? v === ""
                              ? undefined
                              : Number(v)
                            : v,
                        ]),
                      );
                      setResult(calculate(tool, input));
                      setInputs(input);
                      setDirty(true);
                      return false;
                    }}
                  />
                )}
                {result && (
                  <section
                    aria-label="Calculation result"
                    className="space-y-3 rounded-xl border bg-card p-4"
                  >
                    <h2 className="font-display text-xl">Worksheet result</h2>
                    <dl className="grid gap-3 md:grid-cols-2">
                      {Object.entries(result.values).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-sm text-muted-foreground">
                            {key.replace(/_/g, " ")}
                          </dt>
                          <dd className="font-medium">
                            {typeof value === "number"
                              ? Number(value.toFixed(3))
                              : value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {result.notes.map((note) => (
                      <p key={note} className="text-sm">
                        {note}
                      </p>
                    ))}
                    <a
                      className="text-sm underline"
                      href={result.reference}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Clinical reference
                    </a>
                    {approved && d.can_review && pet && (
                      <Button
                        disabled={pending}
                        onClick={() =>
                          void action(async () => {
                            await clinicalCall("save_clinical_calculation", {
                              p_id: crypto.randomUUID(),
                              p_pet_id: pet,
                              p_tool: tool,
                              p_inputs: inputs,
                            });
                            setDirty(false);
                          })
                        }
                      >
                        Review & save worksheet to {d.patient?.name}
                      </Button>
                    )}
                  </section>
                )}
              </>
            ) : (
              <ClinicalHelpers
                key={`${tool}-${pet}`}
                kind={tool as "discharge" | "bloodwork" | "pill"}
                data={d}
                pet={pet}
                disabled={!approved}
                onDirtyChange={setDirty}
              />
            )}
            {d.can_review && (
              <WorkforceForm
                title={`Veterinary protocol review: ${toolNames[tool]}`}
                description="Approve only after checking the cited references, supported cases, known-answer tests and workflow. Provider activation is separate for AI helpers."
                pending={pending}
                fields={[
                  { name: "note", label: "Review notes and accepted scope" },
                  {
                    name: "attest",
                    label:
                      "I reviewed and accept this protocol for the practice",
                    type: "checkbox",
                  },
                ]}
                submit={(v) => {
                  if (!v.attest)
                    throw new Error("Confirm your clinical review first.");
                  return action(() =>
                    clinicalCall("review_clinical_tool", {
                      p_tool: tool,
                      p_note: v.note,
                    }),
                  );
                }}
              />
            )}
            <section className="text-sm text-muted-foreground">
              <a
                className="underline"
                href={references.fluid}
                target="_blank"
                rel="noopener noreferrer"
              >
                AAHA fluid guidelines
              </a>{" "}
              ·{" "}
              <a
                className="underline"
                href={references.chocolate}
                target="_blank"
                rel="noopener noreferrer"
              >
                Merck chocolate reference
              </a>{" "}
              ·{" "}
              <a
                className="underline"
                href={references.gestation}
                target="_blank"
                rel="noopener noreferrer"
              >
                Merck gestation reference
              </a>
            </section>
          </>
        )
      )}
    </div>
  );
}
