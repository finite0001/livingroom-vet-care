import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { errorMessage } from "../inventory/stock-policy";
import { whogotRpc } from "./api";
const instant = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
const correction = z.object({
  id: uuid,
  created_at: instant,
  reason: z.string().optional(),
  replacement_id: uuid.nullable().optional(),
  document: z.object({ reason: z.string() }).passthrough().optional(),
});
const sourceSchema = z.discriminatedUnion("event_type", [
  z.object({
    event_type: z.literal("administered"),
    record: z.object({
      id: uuid,
      pet_id: uuid,
      product_name: z.string(),
      historical: z.boolean(),
      administered_at: instant,
      veterinarian: z.string(),
      dose: z.string(),
      route: z.string(),
      site: z.string(),
      lot_number: z.string(),
      source: z.string(),
    }),
    corrections: z.array(correction),
  }),
  z.object({
    event_type: z.literal("performed"),
    record: z.object({
      id: uuid,
      pet_id: uuid,
      product_name: z.string(),
      performed_at: instant,
      clinician_name: z.string(),
      encounter_id: uuid,
      notes: z.string(),
      created_at: instant,
    }),
    corrections: z.array(correction),
  }),
  z.object({
    event_type: z.literal("dispensed"),
    record: z.object({
      id: uuid,
      pet_id: uuid,
      authorization_id: uuid,
      dispensed_at: instant,
      quantity: z.string(),
      unit: z.string(),
      reason: z.string(),
      reviewed_context: z.object({ product: z.object({ name: z.string() }) }),
      artifact: z.object({
        recorded_by: z.object({ name: z.string() }),
        lots: z.array(z.object({ number: z.string(), quantity: z.string() })),
      }),
    }),
    corrections: z.array(correction),
  }),
]);
export default function WhogotSourcePage() {
  usePageTitle("Received-care source");
  const { eventType, id } = useParams();
  const [params] = useSearchParams();
  const { session } = useAuth();
  const input = z
    .object({
      petId: uuid,
      eventType: z.enum(["administered", "dispensed", "performed"]),
      id: uuid,
    })
    .safeParse({ petId: params.get("patient"), eventType, id });
  const query = useQuery({
    queryKey: [
      "whogot-source",
      session?.user.id,
      eventType,
      id,
      params.get("patient"),
    ],
    enabled: input.success,
    queryFn: async () => {
      if (!input.success) throw new Error("Invalid source link.");
      const source = await whogotRpc("read_whogot_source", {
        p_pet_id: input.data.petId,
        p_event_type: input.data.eventType,
        p_id: input.data.id,
      });
      if (source === null) return null;
      const value = sourceSchema.parse(source);
      if (
        value.record.id !== input.data.id ||
        value.record.pet_id !== input.data.petId ||
        value.event_type !== input.data.eventType
      )
        throw new Error("Source identity mismatch.");
      return value;
    },
  });
  const value = query.data;
  const details: Array<[string, string]> = [];
  if (value?.event_type === "administered") {
    const r = value.record;
    details.push(
      ["Item", r.product_name],
      ["Administered at", r.administered_at],
      ["Veterinarian", r.veterinarian],
      [
        "Dose / route / site",
        [r.dose, r.route, r.site].filter(Boolean).join(" · "),
      ],
      ["Lot", r.lot_number || "Not recorded"],
      ["Source", r.source || "Practice administration"],
      [
        "Evidence",
        r.historical
          ? "Historical administration entry"
          : "Practice administration",
      ],
    );
  }
  if (value?.event_type === "performed") {
    const r = value.record;
    details.push(
      ["Service", r.product_name],
      ["Performed at", r.performed_at],
      ["Performing clinician", r.clinician_name],
      ["Encounter", r.encounter_id],
      ["Recorded at", r.created_at],
      ["Notes", r.notes || "None"],
    );
  }
  if (value?.event_type === "dispensed") {
    const r = value.record;
    details.push(
      ["Medication", r.reviewed_context.product.name],
      ["Dispensed at", r.dispensed_at],
      ["Dispensing staff", r.artifact.recorded_by.name],
      ["Quantity", `${r.quantity} ${r.unit}`],
      [
        "Lots",
        r.artifact.lots.map((l) => `${l.number} (${l.quantity})`).join(", "),
      ],
      ["Reason", r.reason],
      ["Signed prescription", r.authorization_id],
    );
  }
  return (
    <section className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="font-display text-2xl">Received-care source</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Original recorded event and current correction history.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to="/hub/whogot">Whogot</Link>
        </Button>
        {input.success && (
          <Button asChild variant="outline">
            <Link
              to={`/hub/patient/${input.data.petId}?tab=medical&section=${eventType === "performed" ? "soap" : eventType === "administered" ? "treatments" : "prescriptions"}&event=${input.data.id}`}
            >
              Open patient chart
            </Link>
          </Button>
        )}
      </div>
      {!input.success && <p role="alert">Invalid source link.</p>}
      {input.success && query.isPending && <p role="status">Loading source…</p>}
      {query.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query.isSuccess && !value && (
        <p>Source record unavailable for this patient.</p>
      )}
      {value && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg capitalize">
              {value.event_type}
            </CardTitle>
            <p className="break-all text-xs text-muted-foreground">
              Record {value.record.id}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {value.event_type === "dispensed" && (
              <p className="text-sm">
                Dispensing records release of medication from the practice. It
                does not establish administration or owner pickup.
              </p>
            )}
            <dl className="grid gap-3">
              {details.map(([label, text]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-sm">
                    {text}
                  </dd>
                </div>
              ))}
            </dl>
            <h2 className="font-medium">Corrections and annotations</h2>
            {!value.corrections.length && (
              <p className="text-sm">None recorded.</p>
            )}
            {value.corrections.map((c) => (
              <article key={c.id} className="space-y-1 rounded-md border p-3">
                <p className="text-sm">{c.reason || c.document?.reason}</p>
                <p className="text-xs text-muted-foreground">{c.created_at}</p>
                {c.replacement_id && (
                  <p className="break-all text-xs">
                    Replacement record: {c.replacement_id}
                  </p>
                )}
              </article>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
