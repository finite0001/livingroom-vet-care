import type { TemplateDefinition } from "./model";
export function TemplatePreview({
  definition,
}: {
  definition: TemplateDefinition;
}) {
  return (
    <section
      aria-label="Template preview"
      className="min-w-0 space-y-3 rounded-md border border-border bg-background p-3"
    >
      <h4 className="break-words font-medium">{definition.name}</h4>
      <p className="text-sm text-muted-foreground">
        Detail: {definition.detail}. Missing required fields are flagged for
        review, never filled with normal findings.
      </p>
      {definition.fields.map((field) => (
        <div key={field.id} className="min-w-0 border-t border-border pt-2">
          <p className="break-words text-sm font-medium">
            {field.label} · {field.destination} ·{" "}
            {field.required ? "Required" : "Optional"}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {field.instructions || "Use source-supported information only."}
          </p>
        </div>
      ))}
    </section>
  );
}
