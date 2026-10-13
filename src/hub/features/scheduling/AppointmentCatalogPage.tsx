import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUnsavedChanges } from "../clinical/use-unsaved-changes";
import { catalogList } from "./catalog-api";
import { useCatalogAction } from "./use-reviewed-action";
import {
  typeDefinitionSchema,
  resourceDefinitionSchema,
  type CatalogEntry,
  type TypeDefinition,
  type ResourceDefinition,
} from "./catalog-model";

const selectClass =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
interface EditorProps {
  kind: "type" | "resource";
  entry: CatalogEntry | null;
  close: () => void;
}
function CatalogEditor({ kind, entry, close }: EditorProps) {
  const { session } = useAuth(),
    cache = useQueryClient(),
    action = useCatalogAction(session?.user.id ?? "");
  const id = useRef(entry?.id ?? crypto.randomUUID());
  const initial: TypeDefinition | ResourceDefinition =
    entry?.current.definition ??
    (kind === "type"
      ? {
          name: "",
          category: "well",
          species: [],
          visit_types: ["clinic"],
          duration_minutes: null,
          travel_before_minutes: 0,
          travel_after_minutes: 0,
          resource_kind: null,
          staffing: "dvm",
          allow_override: false,
        }
      : {
          name: "",
          resource_kind: "exam",
          visit_types: ["clinic"],
          aliases: [],
        });
  const [definition, setDefinition] = useState(initial),
    [review, setReview] = useState(""),
    [attest, setAttest] = useState(false);
  const [species, setSpecies] = useState(
    "species" in initial ? initial.species.join(", ") : "",
  );
  const [aliases, setAliases] = useState(
    "aliases" in initial ? initial.aliases.join("\n") : "",
  );
  const [done, setDone] = useState(false);
  const baseline = useRef(
    JSON.stringify({
      definition: initial,
      species,
      aliases,
      review: "",
      attest: false,
    }),
  );
  const dirty =
    !done &&
    (action.busy ||
      action.unconfirmed ||
      baseline.current !==
        JSON.stringify({ definition, species, aliases, review, attest }));
  const guard = useUnsavedChanges(
    dirty,
    "This appointment catalog review has unsaved or unconfirmed changes. Keep it open to save or check the action.",
  );
  const disabled = action.busy || action.unconfirmed;
  function dismiss() {
    if (action.busy) return;
    if (
      !dirty ||
      window.confirm(
        action.unconfirmed
          ? "This save is unconfirmed. Leave and lose its recovery action?"
          : "Discard this unsaved catalog review?",
      )
    )
      close();
  }
  function change(patch: Partial<TypeDefinition & ResourceDefinition>) {
    setDefinition((previous) => ({ ...previous, ...patch }));
    setAttest(false);
  }
  const values = {
    ...definition,
    ...(kind === "type"
      ? {
          species: species
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        }
      : {
          aliases: aliases
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
        }),
  };
  const unchanged = Boolean(
    entry &&
      JSON.stringify(values) === JSON.stringify(entry.current.definition),
  );
  async function complete(receipt: CatalogEntry | null) {
    if (!receipt) return;
    setDone(true);
    void cache.invalidateQueries({ queryKey: ["appointment-catalog"] });
    close();
  }
  async function submit(operation: "draft" | "publish" | "retire") {
    try {
      const valid = (
        kind === "type" ? typeDefinitionSchema : resourceDefinitionSchema
      ).parse(values);
      await complete(
        await action.save({
          kind,
          id: id.current,
          expectedVersion: entry?.version ?? null,
          action: operation,
          values: {
            definition: valid,
            review_note: review.trim(),
            attest_review: attest,
          },
        }),
      );
    } catch {
      action.setError(
        "Complete the name, distinct species or aliases, locations, valid times and review note.",
      );
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {entry ? "Review" : "Draft"}{" "}
              {kind === "type" ? "appointment type" : "shared resource"}
            </DialogTitle>
            <DialogDescription>
              Save a draft first. Publication requires review of that exact
              saved draft. Existing bookings keep their reviewed settings.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit("draft");
            }}
          >
            <fieldset disabled={disabled} className="space-y-4">
              <div>
                <Label htmlFor="catalog-name">Name</Label>
                <Input
                  id="catalog-name"
                  required
                  maxLength={150}
                  value={definition.name}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </div>
              {"species" in definition && (
                <>
                  <div>
                    <Label htmlFor="catalog-category">Visit category</Label>
                    <select
                      id="catalog-category"
                      className={selectClass}
                      value={definition.category}
                      onChange={(e) =>
                        change({
                          category: e.target
                            .value as TypeDefinition["category"],
                        })
                      }
                    >
                      <option value="well">Well</option>
                      <option value="sick">Sick</option>
                      <option value="procedure">Procedure</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="catalog-species">
                      Species (comma separated)
                    </Label>
                    <Input
                      id="catalog-species"
                      required
                      value={species}
                      onChange={(e) => {
                        setSpecies(e.target.value);
                        setAttest(false);
                      }}
                    />
                    <p className="text-sm text-muted-foreground">
                      Use the species names on your patient records, such as Dog
                      or Cat.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="catalog-duration">
                      Default duration (minutes)
                    </Label>
                    <Input
                      id="catalog-duration"
                      type="number"
                      min={15}
                      max={480}
                      value={definition.duration_minutes ?? ""}
                      onChange={(e) =>
                        change({
                          duration_minutes:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Leave blank for case-specific duration. Every booking then
                      requires a time review note.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {(
                      ["travel_before_minutes", "travel_after_minutes"] as const
                    ).map((field) => (
                      <div key={field}>
                        <Label htmlFor={field}>
                          {field === "travel_before_minutes"
                            ? "Travel buffer before"
                            : "Travel buffer after"}{" "}
                          (minutes)
                        </Label>
                        <Input
                          id={field}
                          type="number"
                          required
                          min={0}
                          max={240}
                          value={definition[field]}
                          onChange={(e) =>
                            change({ [field]: Number(e.target.value) })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <Label htmlFor="catalog-staffing">
                      Assigned clinician requirement
                    </Label>
                    <select
                      id="catalog-staffing"
                      className={selectClass}
                      value={definition.staffing}
                      onChange={(e) =>
                        change({ staffing: e.target.value as "dvm" | "staff" })
                      }
                    >
                      <option value="dvm">Veterinarian</option>
                      <option value="staff">Active staff</option>
                    </select>
                  </div>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={definition.allow_override}
                      onChange={(e) =>
                        change({ allow_override: e.target.checked })
                      }
                    />
                    Allow time changes with a booking review note
                  </label>
                </>
              )}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Allowed locations
                </legend>
                {(["clinic", "housecall"] as const).map((mode) => (
                  <label
                    key={mode}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={definition.visit_types.includes(mode)}
                      onChange={(e) =>
                        change({
                          visit_types: e.target.checked
                            ? [...definition.visit_types, mode]
                            : definition.visit_types.filter((v) => v !== mode),
                        })
                      }
                    />
                    {mode === "clinic" ? "Clinic" : "Housecall"}
                  </label>
                ))}
              </fieldset>
              <div>
                <Label htmlFor="catalog-resource-kind">
                  {kind === "type" ? "Required resource kind" : "Resource kind"}
                </Label>
                <select
                  id="catalog-resource-kind"
                  className={selectClass}
                  value={definition.resource_kind ?? ""}
                  onChange={(e) =>
                    change({
                      resource_kind: (e.target.value ||
                        null) as TypeDefinition["resource_kind"],
                    })
                  }
                >
                  {kind === "type" && (
                    <option value="">No resource required</option>
                  )}
                  {["exam", "procedure", "vehicle", "equipment", "other"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </div>
              {kind === "resource" && (
                <div>
                  <Label htmlFor="catalog-aliases">
                    Other names for this resource (one per line)
                  </Label>
                  <Textarea
                    id="catalog-aliases"
                    value={aliases}
                    onChange={(e) => {
                      setAliases(e.target.value);
                      setAttest(false);
                    }}
                  />
                  <p className="text-sm text-muted-foreground">
                    Include older schedule names. Published aliases remain
                    reserved for this resource, including after retirement.
                  </p>
                </div>
              )}
              <div>
                <Label htmlFor="catalog-review">Review note</Label>
                <Textarea
                  id="catalog-review"
                  required
                  maxLength={2000}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                />
              </div>
              {entry && (
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={attest}
                    onChange={(e) => setAttest(e.target.checked)}
                  />
                  I reviewed this saved definition and its scheduling rules.
                </label>
              )}
              <p className="text-sm text-muted-foreground">
                {entry
                  ? `Saved revision ${entry.version}: ${entry.current.state}. ${entry.published ? `Bookings currently use published revision ${entry.published.version}.` : "No bookable publication."}`
                  : "New draft; no publication."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" className="min-h-11">
                  Save draft
                </Button>
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={
                    !unchanged ||
                    !attest ||
                    entry?.current.state !== "draft" ||
                    !review.trim()
                  }
                  onClick={() => void submit("publish")}
                >
                  Publish reviewed draft
                </Button>
                {entry?.published && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={!unchanged || !attest || !review.trim()}
                    onClick={() => void submit("retire")}
                  >
                    Retire from new bookings
                  </Button>
                )}
              </div>
            </fieldset>
            {action.error && (
              <p role="alert" className="text-destructive">
                {action.error}
              </p>
            )}
            {action.unconfirmed && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={action.busy}
                  onClick={() => void action.retry().then(complete)}
                >
                  Retry unchanged review
                </Button>
                <Button
                  type="button"
                  disabled={action.busy}
                  onClick={() => void action.checkSaved().then(complete)}
                >
                  Check saved action
                </Button>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={action.busy}
              onClick={dismiss}
            >
              Close
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {guard}
    </>
  );
}
export default function AppointmentCatalogPage() {
  usePageTitle("Appointment catalog");
  const { hasRole } = useAuth(),
    reviewer = hasRole("DVM") || hasRole("ADMIN");
  const [kind, setKind] = useState<"type" | "resource">("type"),
    [editing, setEditing] = useState<{
      entry: CatalogEntry | null;
      kind: "type" | "resource";
    } | null>(null);
  const query = useQuery({
    queryKey: ["appointment-catalog", kind],
    queryFn: () => catalogList(kind),
  });
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl">Appointment catalog</h1>
        <p className="text-muted-foreground">
          Review visit lengths, species, staffing and shared resources before
          using them to book appointments.
        </p>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          to="/hub/schedule"
        >
          Back to schedule
        </Link>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={kind === "type" ? "default" : "outline"}
          className="min-h-11"
          onClick={() => setKind("type")}
        >
          Appointment types
        </Button>
        <Button
          variant={kind === "resource" ? "default" : "outline"}
          className="min-h-11"
          onClick={() => setKind("resource")}
        >
          Shared resources
        </Button>
        {reviewer && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setEditing({ entry: null, kind })}
          >
            New draft
          </Button>
        )}
      </div>
      {query.isPending ? (
        <p role="status">Loading catalog…</p>
      ) : query.isError ? (
        <div role="alert">
          Catalog unavailable.{" "}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          {!query.data.length && (
            <p className="rounded-lg border bg-card p-4">
              No {kind === "type" ? "appointment types" : "shared resources"}{" "}
              yet.{" "}
              {reviewer
                ? "Save and review a draft to publish one. Practice defaults require Susan’s review."
                : "A veterinarian or administrator must review and publish the catalog."}
            </p>
          )}
          <ul className="space-y-3">
            {query.data.map((entry) => (
              <li
                key={entry.id}
                className="space-y-2 rounded-lg border bg-card p-4 shadow-warm"
              >
                <h2 className="font-display text-lg">
                  {entry.current.definition.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Revision {entry.current.version} · {entry.current.state}
                  {entry.published
                    ? ` · Published revision ${entry.published.version} available for bookings`
                    : " · Unavailable for new bookings"}
                </p>
                {"species" in entry.current.definition && (
                  <p>
                    {entry.current.definition.species.join(", ")} ·{" "}
                    {entry.current.definition.category} ·{" "}
                    {entry.current.definition.duration_minutes === null
                      ? "Case-specific duration"
                      : `${entry.current.definition.duration_minutes} minutes`}{" "}
                    ·{" "}
                    {entry.current.definition.staffing === "dvm"
                      ? "Veterinarian required"
                      : "Active staff"}
                  </p>
                )}
                <p className="text-sm">
                  {entry.current.definition.visit_types.join(", ")} ·{" "}
                  {entry.current.definition.resource_kind ??
                    "No resource required"}
                </p>
                {reviewer && (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setEditing({ entry, kind })}
                  >
                    Review configuration
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && (
        <CatalogEditor
          key={editing.entry?.id ?? editing.kind}
          {...editing}
          close={() => setEditing(null)}
        />
      )}
    </main>
  );
}
