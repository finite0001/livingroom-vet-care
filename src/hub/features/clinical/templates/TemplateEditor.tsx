import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  configurationRequestSchemas,
  noteTemplateDefinitionSchema,
  starterDefinition,
  type ConfigurationAction,
  type TemplateDefinition,
  type TemplateRoot,
} from "./model";
import {
  configurationAction,
  readNoteConfiguration,
  readTemplateVersions,
} from "./api";
import { TemplatePreview } from "./TemplatePreview";
interface TemplateEditorProps {
  actor: string;
  canManage: boolean;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "The configuration action could not be confirmed.";
export function TemplateEditor({
  actor,
  canManage,
  blocked,
  onDirtyChange,
  onBusyChange,
}: TemplateEditorProps) {
  const prefix = useId(),
    cache = useQueryClient(),
    lock = useRef(false);
  const key = `lrv:clinical-note-configuration:${actor}`;
  const data = useQuery({
    queryKey: ["clinical-note-configuration", actor],
    queryFn: () => readNoteConfiguration(actor),
  });
  const [selected, setSelected] = useState<TemplateRoot | null>(null),
    [definition, setDefinition] = useState<TemplateDefinition | null>(null),
    [baseline, setBaseline] = useState("");
  const [policyReviewed, setPolicyReviewed] = useState(false),
    [templateReviewed, setTemplateReviewed] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<ConfigurationAction | null>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw) as ConfigurationAction;
      if (
        value.actor !== actor ||
        !configurationRequestSchemas[value.operation]
      )
        throw Error();
      configurationRequestSchemas[value.operation].parse(value.request);
      return value;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    setPolicyReviewed(false);
    setTemplateReviewed(false);
  }, [data.dataUpdatedAt]);
  const dirty = !!definition && JSON.stringify(definition) !== baseline;
  useEffect(() => {
    onDirtyChange(dirty || !!pending || busy);
    return () => onDirtyChange(false);
  }, [dirty, pending, busy, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const disabled =
    blocked || busy || !!pending || !canManage || !data.data || data.isError;
  function edit(root: TemplateRoot | null) {
    if (
      busy ||
      pending ||
      (dirty && !window.confirm("Discard unsaved template changes?"))
    )
      return;
    const next = structuredClone(root?.latest.definition ?? starterDefinition);
    setSelected(root);
    setDefinition(next);
    setBaseline(JSON.stringify(next));
    setTemplateReviewed(false);
    setReason("");
    setError("");
    setNotice("");
  }
  async function run(
    action: ConfigurationAction,
    mode: "save" | "recover" | "cancel" = "save",
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      configurationRequestSchemas[action.operation].parse(action.request);
      sessionStorage.setItem(key, JSON.stringify(action));
      setPending(action);
      let receipt = await configurationAction(action, "recover");
      if (!receipt && mode !== "recover")
        receipt = await configurationAction(action, mode);
      if (!receipt) {
        setNotice(
          "No saved receipt found. Retry the original action or cancel it durably before editing.",
        );
        return;
      }
      sessionStorage.removeItem(key);
      setPending(null);
      setDefinition(null);
      setSelected(null);
      setTemplateReviewed(false);
      setPolicyReviewed(false);
      setReason("");
      setNotice(
        receipt.cancelled
          ? "Unconfirmed configuration action canceled."
          : "Configuration saved. Existing generated notes retain their original template version.",
      );
      await Promise.all([
        cache.invalidateQueries({
          queryKey: ["clinical-note-configuration", actor],
        }),
        cache.invalidateQueries({ queryKey: ["clinical-notes", actor] }),
      ]);
    } catch (failure) {
      setError(message(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function submit(
    operation: ConfigurationAction["operation"],
    request: unknown,
  ) {
    const parsed = configurationRequestSchemas[operation].safeParse(request);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    void run({
      actor,
      id: crypto.randomUUID(),
      operation,
      request: parsed.data,
    });
  }
  function updateField(
    index: number,
    patch: Partial<TemplateDefinition["fields"][number]>,
  ) {
    if (!definition) return;
    setDefinition({
      ...definition,
      fields: definition.fields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    });
  }
  return (
    <details
      className="min-w-0 rounded-lg border border-border bg-background p-4"
      aria-label="Clinical note templates"
    >
      <summary className="min-h-11 cursor-pointer font-semibold">
        Practice templates and approval
      </summary>
      <div className="mt-3 min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">
          Template versions preserve headings and source instructions. Required
          fields identify missing information; they never supply normal
          findings. Only administrators can save or approve practice
          configuration.
        </p>
        {data.isPending && <p role="status">Loading practice templates…</p>}
        {data.isError && (
          <p role="alert">
            Practice templates are unavailable.{" "}
            <Button variant="outline" onClick={() => void data.refetch()}>
              Retry templates
            </Button>
          </p>
        )}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {busy && <p role="status">Saving practice configuration…</p>}
        {pending && (
          <div className="space-y-2">
            <p className="text-sm">
              An earlier configuration action is unconfirmed. Resolve that exact
              action before editing.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void run(pending, "recover")}
              >
                Recover configuration action
              </Button>
              <Button disabled={busy} onClick={() => void run(pending)}>
                Retry configuration action
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void run(pending, "cancel")}
              >
                Cancel unconfirmed configuration action
              </Button>
            </div>
          </div>
        )}
        {data.data && (
          <section
            className="space-y-2 rounded-md border border-border p-3"
            aria-label="Note processing policy"
          >
            <h4 className="font-medium">
              Note processing policy · {data.data.policy.status} · version{" "}
              {data.data.policy.version}
            </h4>
            <p className="whitespace-pre-wrap break-words text-sm">
              {data.data.policy.consent_text}
            </p>
            <p className="text-sm text-muted-foreground">
              Model: {data.data.policy.soap_model}. Approval is required before
              typed observations or existing transcripts can be processed. Audio
              recording keeps its separate approval and consent requirements.
            </p>
            {canManage && (
              <>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={policyReviewed}
                    disabled={disabled || dirty}
                    onChange={(e) => setPolicyReviewed(e.target.checked)}
                  />
                  I reviewed this exact policy and the permitted clinical use
                  with the practice approver.
                </label>
                <Button
                  variant="outline"
                  disabled={disabled || dirty || !policyReviewed}
                  onClick={() =>
                    submit("policy", {
                      expected_version: data.data!.policy.version,
                      status:
                        data.data!.policy.status === "draft"
                          ? "approved"
                          : "draft",
                      consent_text: data.data!.policy.consent_text,
                      attest_reviewed: true,
                    })
                  }
                >
                  {data.data.policy.status === "draft"
                    ? "Approve note processing policy"
                    : "Return processing policy to draft"}
                </Button>
              </>
            )}
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {data.data?.templates.map((root) => (
            <Button
              key={root.id}
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal text-left"
              disabled={busy || !!pending}
              onClick={() => edit(root)}
            >
              {root.latest.definition.name} · latest v{root.latest_version} ·{" "}
              {root.retired
                ? "Retired"
                : root.approved_version
                  ? `Approved v${root.approved_version}`
                  : "Draft"}
            </Button>
          ))}
          {canManage && (
            <Button disabled={disabled} onClick={() => edit(null)}>
              New template
            </Button>
          )}
        </div>
        {definition && (
          <section
            className="min-w-0 space-y-4 border-t border-border pt-3"
            aria-label="Template editor"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium">
                {selected
                  ? `Template history · revision ${selected.revision}`
                  : "New draft template"}
              </h4>
              <Button
                variant="ghost"
                disabled={busy || !!pending}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("Discard unsaved template changes?")
                  ) {
                    setDefinition(null);
                    setSelected(null);
                  }
                }}
              >
                Close template editor
              </Button>
            </div>
            {selected && (
              <p className="break-all text-xs text-muted-foreground">
                Latest immutable version {selected.latest.version}:{" "}
                {selected.latest.sha256}
                {selected.approved && (
                  <>
                    {" "}
                    · Approved version {selected.approved.version}:{" "}
                    {selected.approved.sha256}
                  </>
                )}
              </p>
            )}
            <fieldset
              disabled={disabled || selected?.retired}
              className="min-w-0 space-y-4"
            >
              <legend className="sr-only">Template definition</legend>
              <Label htmlFor={`${prefix}-name`}>Template name</Label>
              <Input
                id={`${prefix}-name`}
                maxLength={120}
                value={definition.name}
                onChange={(e) =>
                  setDefinition({ ...definition, name: e.target.value })
                }
              />
              <Label htmlFor={`${prefix}-detail`}>Output detail</Label>
              <select
                id={`${prefix}-detail`}
                className="min-h-11 w-full rounded-md border border-input bg-background p-2"
                value={definition.detail}
                onChange={(e) =>
                  setDefinition({
                    ...definition,
                    detail: e.target.value as TemplateDefinition["detail"],
                  })
                }
              >
                <option value="concise">Concise</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
              {definition.fields.map((field, i) => (
                <div
                  key={i}
                  className="min-w-0 space-y-2 rounded-md border border-border p-3"
                >
                  <h5 className="font-medium">Field {i + 1}</h5>
                  <Label htmlFor={`${prefix}-id-${i}`}>Stable field ID</Label>
                  <Input
                    id={`${prefix}-id-${i}`}
                    maxLength={48}
                    value={field.id}
                    onChange={(e) => updateField(i, { id: e.target.value })}
                  />
                  <Label htmlFor={`${prefix}-label-${i}`}>Field label</Label>
                  <Input
                    id={`${prefix}-label-${i}`}
                    maxLength={120}
                    value={field.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                  />
                  <Label htmlFor={`${prefix}-destination-${i}`}>
                    SOAP destination
                  </Label>
                  <select
                    id={`${prefix}-destination-${i}`}
                    className="min-h-11 w-full rounded-md border border-input bg-background p-2"
                    value={field.destination}
                    onChange={(e) =>
                      updateField(i, {
                        destination: e.target
                          .value as TemplateDefinition["fields"][number]["destination"],
                      })
                    }
                  >
                    {["subjective", "objective", "assessment", "plan"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                  <Label htmlFor={`${prefix}-instructions-${i}`}>
                    Source instructions
                  </Label>
                  <Textarea
                    id={`${prefix}-instructions-${i}`}
                    maxLength={500}
                    value={field.instructions}
                    onChange={(e) =>
                      updateField(i, { instructions: e.target.value })
                    }
                  />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        updateField(i, { required: e.target.checked })
                      }
                    />
                    Flag when missing
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={i === 0}
                      onClick={() => {
                        const fields = [...definition.fields];
                        [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]];
                        setDefinition({ ...definition, fields });
                      }}
                    >
                      Move field {i + 1} up
                    </Button>
                    <Button
                      variant="outline"
                      disabled={definition.fields.length <= 1}
                      onClick={() =>
                        setDefinition({
                          ...definition,
                          fields: definition.fields.filter((_, at) => at !== i),
                        })
                      }
                    >
                      Remove field {i + 1}
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                disabled={definition.fields.length >= 48}
                onClick={() =>
                  setDefinition({
                    ...definition,
                    fields: [
                      ...definition.fields,
                      {
                        id: `field_${definition.fields.length + 1}`,
                        label: "New field",
                        destination: "plan",
                        instructions: "",
                        required: false,
                      },
                    ],
                  })
                }
              >
                Add template field
              </Button>
              <p className="text-xs text-muted-foreground">
                Each save creates an immutable version. Review and approve the
                saved version separately. Instructions cannot create patient
                facts or signatures.
              </p>
              <Button
                disabled={
                  !dirty ||
                  !noteTemplateDefinitionSchema.safeParse(definition).success
                }
                onClick={() =>
                  selected
                    ? submit("save_template", {
                        template_id: selected.id,
                        expected_revision: selected.revision,
                        definition,
                      })
                    : submit("create_template", {
                        template_id: crypto.randomUUID(),
                        definition,
                      })
                }
              >
                Save new template version
              </Button>
            </fieldset>
            <TemplatePreview definition={definition} />
            {selected && (
              <TemplateHistory
                key={`${selected.id}:${selected.revision}`}
                actor={actor}
                template={selected.id}
              />
            )}
            {selected && !selected.retired && canManage && (
              <fieldset disabled={disabled || dirty} className="space-y-3">
                <legend className="font-medium">
                  Review saved template version {selected.latest.version}
                </legend>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={templateReviewed}
                    onChange={(e) => setTemplateReviewed(e.target.checked)}
                  />
                  I reviewed every heading and instruction; absent findings must
                  remain absent.
                </label>
                <Button
                  disabled={!templateReviewed}
                  onClick={() =>
                    submit("approve_template", {
                      template_id: selected.id,
                      expected_revision: selected.revision,
                      version: selected.latest.version,
                      sha256: selected.latest.sha256,
                      attest_reviewed: true,
                    })
                  }
                >
                  Approve saved template version
                </Button>
                <Label htmlFor={`${prefix}-retire`}>Retirement reason</Label>
                <Textarea
                  id={`${prefix}-retire`}
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={!reason.trim()}
                  onClick={() =>
                    submit("retire_template", {
                      template_id: selected.id,
                      expected_revision: selected.revision,
                      reason,
                    })
                  }
                >
                  Retire template
                </Button>
              </fieldset>
            )}
          </section>
        )}
      </div>
    </details>
  );
}

function TemplateHistory({
  actor,
  template,
}: {
  actor: string;
  template: string;
}) {
  const [before, setBefore] = useState<number | null>(null);
  const data = useQuery({
    queryKey: ["clinical-note-template-versions", actor, template, before],
    queryFn: () => readTemplateVersions(actor, template, before),
  });
  return (
    <details className="min-w-0 rounded-md border border-border p-3">
      <summary className="min-h-11 cursor-pointer font-medium">
        Immutable template version history
      </summary>
      <div className="space-y-3">
        {data.isPending && <p role="status">Loading template history…</p>}
        {data.isError && (
          <p role="alert">
            Template history is unavailable.{" "}
            <Button variant="outline" onClick={() => void data.refetch()}>
              Retry template history
            </Button>
          </p>
        )}
        {data.data?.versions.map((version) => (
          <details
            key={version.version}
            className="min-w-0 border-t border-border pt-2"
          >
            <summary className="min-h-11 cursor-pointer break-words text-sm">
              Version {version.version} · {version.status} ·{" "}
              {version.definition.name}
            </summary>
            <p className="break-all text-xs text-muted-foreground">
              SHA256: {version.sha256}
            </p>
            <TemplatePreview definition={version.definition} />
          </details>
        ))}
        <div className="flex flex-wrap gap-2">
          {before !== null && (
            <Button variant="outline" onClick={() => setBefore(null)}>
              Latest template versions
            </Button>
          )}
          {data.data?.has_more && (
            <Button
              variant="outline"
              onClick={() =>
                setBefore(
                  data.data!.versions[data.data!.versions.length - 1].version,
                )
              }
            >
              Earlier template versions
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
