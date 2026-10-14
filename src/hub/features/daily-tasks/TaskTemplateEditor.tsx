import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { catalogList } from "../scheduling/catalog-api";
import { operationalAssignees } from "./task-api";
import {
  taskDefinitionSchema,
  canonicalOperationalValue,
  type TaskDefinition,
  type OperationalTemplate,
} from "./task-model";
import { useOperationalAction } from "./use-task-action";
import {
  OperationalDialog,
  OperationalActionStatus,
} from "./OperationalDialog";
import { operationalSelectClass, operationalTimeLabel } from "./task-ui";
import { refreshOperationalFacts } from "./task-invalidation";
interface TaskTemplateEditorProps {
  entry: OperationalTemplate | null;
  close: () => void;
  reload: () => void;
}
const triggers = {
  turnover: "after_use",
  preparation: "before_visit",
  restock: "resource_day",
  housecall: "before_departure",
} as const;
const roleLabels = {
  STAFF: "Staff",
  TECH: "Technician",
  DVM: "Veterinarian",
  ADMIN: "Administrator",
} as const;
export function TaskTemplateEditor({
  entry,
  close,
  reload,
}: TaskTemplateEditorProps) {
  const { session, hasRole } = useAuth(),
    reviewer = hasRole("DVM") || hasRole("ADMIN"),
    actor = session?.user.id ?? "",
    cache = useQueryClient(),
    id = useRef(entry?.id ?? crypto.randomUUID());
  const initial: TaskDefinition = entry?.current.definition ?? {
    name: "",
    category: "turnover",
    trigger: "after_use",
    selectors: { types: [], resources: [] },
    due: { offset_minutes: 0, local_time: null, dst_resolution: "reject" },
    eligible_roles: [],
    assignment: "unassigned",
    assignee_id: null,
    checklist: [{ id: crypto.randomUUID(), label: "", required: true }],
    sop_reference: "",
  };
  const [definition, setDefinition] = useState(initial),
    [offset, setOffset] = useState(
      entry ? String(initial.due.offset_minutes) : "",
    ),
    [note, setNote] = useState(""),
    [attest, setAttest] = useState(false),
    [done, setDone] = useState(false);
  const initialState = useRef(
    canonicalOperationalValue({
      definition: initial,
      offset: entry ? String(initial.due.offset_minutes) : "",
      note: "",
      attest: false,
    }),
  );
  const action = useOperationalAction(actor, "template", () => {
    setDone(true);
    refreshOperationalFacts(cache, actor);
    close();
  });
  const frozen = action.busy || action.pending,
    dirty =
      !done &&
      (frozen ||
        initialState.current !==
          canonicalOperationalValue({ definition, offset, note, attest }));
  const catalog = useQuery({
    queryKey: ["operational", actor, "template-catalog"],
    enabled: !!actor,
    queryFn: async () => {
      const [types, resources] = await Promise.all([
        catalogList("type"),
        catalogList("resource"),
      ]);
      return { types, resources };
    },
    refetchOnWindowFocus: !dirty,
  });
  const people = useQuery({
    queryKey: ["operational", actor, "assignees", definition.eligible_roles],
    enabled: !!actor && definition.eligible_roles.length > 0,
    queryFn: () => operationalAssignees(definition.eligible_roles),
    refetchOnWindowFocus: !dirty,
  });
  function change(next: TaskDefinition) {
    setDefinition(next);
    setAttest(false);
  }
  const values = {
    ...definition,
    due: {
      ...definition.due,
      offset_minutes:
        definition.trigger === "resource_day"
          ? 0
          : offset.trim() === ""
            ? Number.NaN
            : Number(offset),
    },
  };
  const unchanged =
    !!entry &&
    canonicalOperationalValue(values) ===
      canonicalOperationalValue(entry.current.definition);
  async function submit(operation: "draft" | "publish" | "retire") {
    try {
      const valid = taskDefinitionSchema.parse(values);
      if (operation !== "draft" && (!unchanged || !attest)) {
        action.setError(
          "Review the unchanged saved checklist before publication or retirement.",
        );
        return;
      }
      await action.save({
        id: id.current,
        expected_version: entry?.version ?? null,
        action: operation,
        definition: valid,
        review_note: note.trim(),
        attest_review: attest,
      });
    } catch {
      action.setError(
        "Complete the name, reviewed selections, timing, roles, checklist, SOP/reference and review note.",
      );
    }
  }
  function selectors(kind: "types" | "resources") {
    return (
      <section className="space-y-2">
        <h3 className="font-semibold">
          {kind === "types"
            ? "Applies to appointment types"
            : "Uses these resources"}
        </h3>
        {kind === "types" &&
          definition.trigger !== "before_visit" &&
          definition.trigger !== "before_departure" && (
            <p className="text-xs text-muted-foreground">
              Leave types empty to include actual use of every selected
              resource.
            </p>
          )}
        {catalog.isPending ? (
          <p role="status">Loading reviewed selections…</p>
        ) : catalog.isError ? (
          <p role="alert">
            Catalog unavailable.{" "}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void catalog.refetch()}
            >
              Retry catalog
            </Button>
          </p>
        ) : (
          <div className="space-y-1">
            {catalog.data?.[kind].map((item) => {
              const selected = definition.selectors[kind].find(
                  (value) => value.entry_id === item.id,
                ),
                published = item.published;
              return (
                <div key={item.id} className="rounded-lg border p-2">
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-primary"
                      checked={!!selected}
                      disabled={frozen || (!published && !selected)}
                      onChange={(e) => {
                        const next = definition.selectors[kind].filter(
                          (value) => value.entry_id !== item.id,
                        );
                        if (e.target.checked && published)
                          next.push({
                            entry_id: item.id,
                            version_id: published.id,
                          });
                        change({
                          ...definition,
                          selectors: { ...definition.selectors, [kind]: next },
                        });
                      }}
                    />
                    <span className="text-sm break-words">
                      {published?.definition.name ??
                        item.current.definition.name}{" "}
                      ·{" "}
                      {published
                        ? `published v${published.version}`
                        : "not currently published"}
                    </span>
                  </label>
                  {selected &&
                    published &&
                    selected.version_id !== published.id && (
                      <div className="text-sm">
                        <p>The selected review is an earlier publication.</p>
                        <Button
                          type="button"
                          className="min-h-11"
                          variant="outline"
                          disabled={frozen}
                          onClick={() =>
                            change({
                              ...definition,
                              selectors: {
                                ...definition.selectors,
                                [kind]: definition.selectors[kind].map(
                                  (value) =>
                                    value.entry_id === item.id
                                      ? {
                                          entry_id: item.id,
                                          version_id: published.id,
                                        }
                                      : value,
                                ),
                              },
                            })
                          }
                        >
                          Use current publication of {published.definition.name}
                        </Button>
                      </div>
                    )}
                </div>
              );
            })}
            {catalog.data?.[kind].length === 0 && (
              <p className="text-sm">
                No catalog entries yet. Review them in the appointment catalog
                first.
              </p>
            )}
          </div>
        )}
      </section>
    );
  }
  return (
    <OperationalDialog
      title={
        entry ? "Review operational template" : "Draft operational template"
      }
      description="Save a complete draft first, then review that exact saved version before publishing. Existing work retains its original checklist."
      dirty={dirty}
      busy={action.busy}
      pending={action.pending}
      close={close}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit("draft");
        }}
      >
        <fieldset className="space-y-4" disabled={frozen || !reviewer}>
          <div>
            <Label htmlFor="task-template-name">Template name</Label>
            <Input
              className="min-h-11"
              id="task-template-name"
              required
              maxLength={150}
              value={definition.name}
              onChange={(e) => change({ ...definition, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="task-template-category">Operational work</Label>
            <select
              className={operationalSelectClass}
              id="task-template-category"
              value={definition.category}
              onChange={(e) => {
                const category = e.target.value as TaskDefinition["category"];
                change({
                  ...definition,
                  category,
                  trigger: triggers[category],
                  due: {
                    ...definition.due,
                    local_time: category === "restock" ? "" : null,
                    offset_minutes: 0,
                  },
                });
                setOffset("");
              }}
            >
              <option value="turnover">
                Cleanup after actual resource use
              </option>
              <option value="preparation">
                Preparation before a selected visit
              </option>
              <option value="restock">
                Restock per resource and local day
              </option>
              <option value="housecall">
                Kit check before planned housecall departure
              </option>
            </select>
          </div>
          {selectors("types")}
          {selectors("resources")}
          <section className="grid gap-3 md:grid-cols-2">
            {definition.trigger === "resource_day" ? (
              <div>
                <Label htmlFor="task-template-local-time">
                  Restock due time (Denver)
                </Label>
                <Input
                  className="min-h-11"
                  id="task-template-local-time"
                  type="time"
                  required
                  value={definition.due.local_time ?? ""}
                  onChange={(e) =>
                    change({
                      ...definition,
                      due: { ...definition.due, local_time: e.target.value },
                    })
                  }
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="task-template-offset">
                  Minutes{" "}
                  {definition.trigger === "after_use"
                    ? "after actual use ends"
                    : definition.trigger === "before_departure"
                      ? "before planned departure"
                      : "before the visit"}
                </Label>
                <Input
                  className="min-h-11"
                  id="task-template-offset"
                  type="number"
                  min={0}
                  max={1440}
                  required
                  value={offset}
                  onChange={(e) => {
                    setOffset(e.target.value);
                    setAttest(false);
                  }}
                />
              </div>
            )}
            <div>
              <Label htmlFor="task-template-dst">Repeated local hour</Label>
              <select
                className={operationalSelectClass}
                id="task-template-dst"
                value={definition.due.dst_resolution}
                onChange={(e) =>
                  change({
                    ...definition,
                    due: {
                      ...definition.due,
                      dst_resolution: e.target
                        .value as TaskDefinition["due"]["dst_resolution"],
                    },
                  })
                }
              >
                <option value="reject">Require review</option>
                <option value="earlier">Use the earlier occurrence</option>
                <option value="later">Use the later occurrence</option>
              </select>
            </div>
          </section>
          <section>
            <h3 className="font-semibold">Eligible roles</h3>
            <div className="flex flex-wrap gap-x-4">
              {Object.entries(roleLabels).map(([role, label]) => (
                <label key={role} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={definition.eligible_roles.includes(
                      role as TaskDefinition["eligible_roles"][number],
                    )}
                    onChange={(e) =>
                      change({
                        ...definition,
                        eligible_roles: e.target.checked
                          ? [
                              ...definition.eligible_roles,
                              role as TaskDefinition["eligible_roles"][number],
                            ]
                          : definition.eligible_roles.filter(
                              (value) => value !== role,
                            ),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>
          <section className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="task-template-assignment">Assignment</Label>
              <select
                id="task-template-assignment"
                className={operationalSelectClass}
                value={definition.assignment}
                onChange={(e) =>
                  change({
                    ...definition,
                    assignment: e.target.value as TaskDefinition["assignment"],
                    assignee_id: null,
                  })
                }
              >
                <option value="unassigned">Available to eligible staff</option>
                <option value="named">Named eligible staff member</option>
              </select>
            </div>
            {definition.assignment === "named" && (
              <div>
                <Label htmlFor="task-template-person">Staff member</Label>
                <select
                  className={operationalSelectClass}
                  id="task-template-person"
                  required
                  value={definition.assignee_id ?? ""}
                  onChange={(e) =>
                    change({
                      ...definition,
                      assignee_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">Choose eligible staff</option>
                  {definition.assignee_id &&
                    !people.data?.some(
                      (person) => person.id === definition.assignee_id,
                    ) && (
                      <option value={definition.assignee_id}>
                        Previously selected member · review eligibility
                      </option>
                    )}
                  {people.data?.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name || "Staff member"}
                    </option>
                  ))}
                </select>
                {definition.eligible_roles.length === 0 ? (
                  <p role="status">Choose eligible roles first.</p>
                ) : people.isPending ? (
                  <p role="status">Loading eligible staff…</p>
                ) : null}
                {people.isError && (
                  <p role="alert">
                    Eligible staff unavailable.{" "}
                    <Button
                      type="button"
                      className="min-h-11"
                      variant="outline"
                      onClick={() => void people.refetch()}
                    >
                      Retry eligible staff
                    </Button>
                  </p>
                )}
              </div>
            )}
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">Checklist</h3>
            {definition.checklist.map((item, index) => (
              <div key={item.id} className="space-y-2 rounded-xl border p-3">
                <Label htmlFor={`task-item-${item.id}`}>
                  Checklist item {index + 1}
                </Label>
                <Textarea
                  className="min-h-11"
                  id={`task-item-${item.id}`}
                  required
                  maxLength={1000}
                  value={item.label}
                  onChange={(e) =>
                    change({
                      ...definition,
                      checklist: definition.checklist.map((value) =>
                        value.id === item.id
                          ? { ...value, label: e.target.value }
                          : value,
                      ),
                    })
                  }
                />
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={item.required}
                    onChange={(e) =>
                      change({
                        ...definition,
                        checklist: definition.checklist.map((value) =>
                          value.id === item.id
                            ? { ...value, required: e.target.checked }
                            : value,
                        ),
                      })
                    }
                  />
                  Required to complete
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="outline"
                    disabled={index === 0}
                    onClick={() => {
                      const items = [...definition.checklist];
                      [items[index - 1], items[index]] = [
                        items[index],
                        items[index - 1],
                      ];
                      change({ ...definition, checklist: items });
                    }}
                  >
                    Move item {index + 1} up
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="outline"
                    disabled={index === definition.checklist.length - 1}
                    onClick={() => {
                      const items = [...definition.checklist];
                      [items[index], items[index + 1]] = [
                        items[index + 1],
                        items[index],
                      ];
                      change({ ...definition, checklist: items });
                    }}
                  >
                    Move item {index + 1} down
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="outline"
                    disabled={definition.checklist.length <= 1}
                    onClick={() =>
                      change({
                        ...definition,
                        checklist: definition.checklist.filter(
                          (value) => value.id !== item.id,
                        ),
                      })
                    }
                  >
                    Remove item {index + 1}
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              className="min-h-11"
              variant="outline"
              disabled={definition.checklist.length >= 50}
              onClick={() =>
                change({
                  ...definition,
                  checklist: [
                    ...definition.checklist,
                    { id: crypto.randomUUID(), label: "", required: true },
                  ],
                })
              }
            >
              Add checklist item
            </Button>
          </section>
          <div>
            <Label htmlFor="task-template-sop">Approved SOP or reference</Label>
            <Textarea
              id="task-template-sop"
              required
              maxLength={2000}
              value={definition.sop_reference}
              onChange={(e) =>
                change({ ...definition, sop_reference: e.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="task-template-review-note">Review note</Label>
            <Textarea
              id="task-template-review-note"
              required
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {entry && (
            <>
              <p className="text-sm">
                Saved v{entry.current.version} ·{" "}
                {entry.reviewer_name || "Recorded reviewer"} ·{" "}
                {operationalTimeLabel(entry.current.recorded_at)}
              </p>
              <label className="flex min-h-11 items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-primary"
                  checked={attest}
                  disabled={!unchanged}
                  onChange={(e) => setAttest(e.target.checked)}
                />
                <span className="text-sm">
                  I reviewed this exact saved checklist and its type, resource,
                  timing and assignment rules.
                </span>
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              type="submit"
              disabled={catalog.isPending || catalog.isError}
            >
              Save template draft
            </Button>
            {entry?.current.state === "draft" && (
              <Button
                className="min-h-11"
                type="button"
                disabled={!unchanged || !attest}
                onClick={() => void submit("publish")}
              >
                Publish reviewed template
              </Button>
            )}
            {entry?.published && (
              <Button
                className="min-h-11"
                type="button"
                variant="outline"
                disabled={!unchanged || !attest}
                onClick={() => {
                  if (
                    window.confirm(
                      "Retire this template? New tasks stop using it; existing obligations remain.",
                    )
                  )
                    void submit("retire");
                }}
              >
                Retire template
              </Button>
            )}
          </div>
        </fieldset>
        <OperationalActionStatus action={action} />
        {entry && !frozen && (
          <Button
            className="min-h-11"
            type="button"
            variant="outline"
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Discard this draft and reload the saved template?",
                )
              )
                reload();
            }}
          >
            Reload saved template
          </Button>
        )}
      </form>
    </OperationalDialog>
  );
}
