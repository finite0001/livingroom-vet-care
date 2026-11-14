import { z } from "zod";
import { useAuth } from "@/hub/contexts/auth-context";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export interface FormField {
  name: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "date"
    | "datetime-local"
    | "checkbox"
    | "textarea";
  optional?: boolean;
  value?: string | number | boolean | null;
  options?: { value: string; label: string }[];
}
interface WorkforceFormProps {
  title: string;
  fields: FormField[];
  pending: boolean;
  submit: (
    values: Record<string, string | boolean>,
    requestId: string,
  ) => Promise<boolean>;
  button?: string;
  description?: string;
  onDirtyChange?: (dirty: boolean) => void;
}
export function WorkforceForm({
  title,
  fields,
  pending,
  submit,
  button = "Save",
  description,
  onDirtyChange,
}: WorkforceFormProps) {
  const { session } = useAuth();
  const pointerKey = `lrv:staff-form-request:${session?.user.id}:${title}`;
  const newRequestId = () => {
    const value = crypto.randomUUID();
    try {
      sessionStorage.setItem(pointerKey, value);
    } catch {
      /* ID-only recovery is best effort in restricted browser storage. */
    }
    return value;
  };
  const [requestId, setRequestId] = useState(() => {
    try {
      const saved = sessionStorage.getItem(pointerKey);
      if (saved && z.string().uuid().safeParse(saved).success) return saved;
    } catch {
      /* Restricted browser storage. */
    }
    return newRequestId();
  });
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  return (
    <form
      key={`${id}-${revision}`}
      className="space-y-3 rounded-xl border bg-card p-4"
      onChange={() => onDirtyChange?.(true)}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const values = Object.fromEntries(
          fields.map((f) => [
            f.name,
            f.type === "checkbox"
              ? data.has(f.name)
              : String(data.get(f.name) ?? ""),
          ]),
        );
        try {
          setError("");
          if (await submit(values, requestId)) {
            setRevision((v) => v + 1);
            setRequestId(newRequestId());
            onDirtyChange?.(false);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Please check the form.");
        }
      }}
    >
      <h2 className="font-display text-lg">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name} className="space-y-1 text-sm">
            <label htmlFor={`${id}-${f.name}`}>{f.label}</label>
            {f.options ? (
              <select
                id={`${id}-${f.name}`}
                name={f.name}
                required={!f.optional}
                defaultValue={String(f.value ?? "")}
                className="h-11 w-full rounded-md border bg-background px-3"
              >
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "checkbox" ? (
              <input
                id={`${id}-${f.name}`}
                name={f.name}
                type="checkbox"
                defaultChecked={Boolean(f.value)}
                className="ml-3 h-5 w-5 align-middle"
              />
            ) : (
              <Input
                id={`${id}-${f.name}`}
                name={f.name}
                type={f.type ?? "text"}
                step={f.type === "number" ? "any" : undefined}
                required={!f.optional}
                defaultValue={
                  f.value === null || f.value === undefined
                    ? ""
                    : String(f.value)
                }
                className="h-11"
              />
            )}
          </div>
        ))}
      </div>
      <Button disabled={pending} type="submit">
        {pending ? "Saving…" : button}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              "Reset this form? If a save was not confirmed, check saved records before creating a new request.",
            )
          ) {
            setRequestId(newRequestId());
            setRevision((v) => v + 1);
            setError("");
            onDirtyChange?.(false);
          }
        }}
      >
        Reset form
      </Button>
    </form>
  );
}
