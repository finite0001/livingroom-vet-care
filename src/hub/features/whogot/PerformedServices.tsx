import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { denverDateTime, denverInstant } from "../clinical/editor-state";
import { errorMessage } from "../inventory/stock-policy";
import { searchWhogotProducts, whogotRpc } from "./api";
const serviceSchema = z.object({
  id: z.string().uuid(),
  pet_id: z.string().uuid(),
  encounter_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string(),
  performed_at: z.string().datetime({ offset: true }),
  notes: z.string(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  correction: z
    .object({
      id: z.string().uuid(),
      reason: z.string(),
      replacement_id: z.string().uuid().nullable(),
      created_at: z.string(),
      created_by: z.string().uuid(),
    })
    .nullable(),
});
const requestSchema = z.object({
  pet_id: z.string().uuid(),
  encounter_id: z.string().uuid(),
  product_id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  performed_at: z.string().datetime(),
  notes: z.string().max(2000),
  invoice_id: z.null(),
});
interface ServiceOperation {
  id: string;
  actorId: string;
  name: "record_patient_service" | "correct_patient_service";
  args: Record<string, unknown>;
}
interface PerformedServicesProps {
  petId: string;
  encounterId: string | null;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}
const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
export function PerformedServices({
  petId,
  encounterId,
  disabled = false,
  onDirtyChange,
}: PerformedServicesProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [params] = useSearchParams();
  const initialTime = useRef(denverDateTime(new Date()));
  const [productId, setProductId] = useState(""),
    [clinicianId, setClinicianId] = useState(""),
    [when, setWhen] = useState(() => initialTime.current),
    [notes, setNotes] = useState("");
  const [needle, setNeedle] = useState(""),
    [debounced, setDebounced] = useState("");
  const [correctionId, setCorrectionId] = useState(""),
    [reason, setReason] = useState(""),
    [replacementId, setReplacementId] = useState("");
  const [pending, setPending] = useState<ServiceOperation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const dirty =
    !!productId ||
    !!clinicianId ||
    when !== initialTime.current ||
    !!notes ||
    !!reason ||
    !!correctionId ||
    !!pending ||
    busy;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(needle.trim()), 250);
    return () => clearTimeout(timer);
  }, [needle]);
  const history = useQuery({
    queryKey: ["patient-services", session?.user.id, petId],
    refetchOnWindowFocus: !dirty,
    queryFn: async () =>
      z
        .array(serviceSchema)
        .parse(await whogotRpc("list_patient_services", { p_pet_id: petId })),
  });
  const products = useQuery({
    queryKey: ["whogot-products", session?.user.id, debounced],
    queryFn: () => searchWhogotProducts(debounced),
  });
  const clinicians = useQuery({
    queryKey: ["service-clinicians", session?.user.id],
    queryFn: async () =>
      z
        .array(z.object({ id: z.string().uuid(), name: z.string() }))
        .parse(await whogotRpc("list_service_clinicians", {})),
  });
  const send = async (operation: ServiceOperation) => {
    if (lock.current) return;
    if (session?.user.id !== operation.actorId) {
      setError(
        "Sign in with the account that started this operation to retry.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setPending(operation);
    setError("");
    setMessage("");
    try {
      // Exact operation identity is retained on an interrupted response; a retry cannot duplicate a service.
      const result = await whogotRpc(operation.name, operation.args);
      z.object({ id: z.literal(operation.id) }).parse(result);
      setPending(null);
      setProductId("");
      setClinicianId("");
      setNotes("");
      initialTime.current = denverDateTime(new Date());
      setWhen(initialTime.current);
      setCorrectionId("");
      setReason("");
      setReplacementId("");
      setMessage(
        operation.name === "record_patient_service"
          ? "Service completion recorded. No charge was created."
          : "Correction recorded. Original history is retained.",
      );
      await cache.invalidateQueries({ queryKey: ["patient-services"] });
      await cache.invalidateQueries({ queryKey: ["whogot"] });
    } catch (failure) {
      // Known server rejections did not commit this request; network failures stay locked for exact retry.
      if (
        failure &&
        typeof failure === "object" &&
        "code" in failure &&
        typeof failure.code === "string" &&
        /^(23514|23505|42501|PT409|22)/.test(failure.code)
      )
        setPending(null);
      setError(errorMessage(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const record = () => {
    try {
      if (!session?.user.id || !encounterId)
        throw new Error("Select a saved encounter before recording a service.");
      const request = requestSchema.parse({
        pet_id: petId,
        encounter_id: encounterId,
        product_id: productId,
        clinician_id: clinicianId,
        performed_at: denverInstant(when),
        notes: notes.trim(),
        invoice_id: null,
      });
      const id = crypto.randomUUID();
      void send({
        id,
        actorId: session.user.id,
        name: "record_patient_service",
        args: { p_id: id, p_request: request },
      });
    } catch (failure) {
      setError(
        failure instanceof z.ZodError
          ? failure.issues[0].message
          : errorMessage(failure),
      );
    }
  };
  const correct = () => {
    try {
      if (!session?.user.id) throw new Error("Sign in to record a correction.");
      const parsed = z
        .object({
          eventId: z.string().uuid(),
          reason: z.string().trim().min(1).max(2000),
          replacementId: z.union([z.literal(""), z.string().uuid()]),
        })
        .parse({ eventId: correctionId, reason, replacementId });
      const id = crypto.randomUUID();
      void send({
        id,
        actorId: session.user.id,
        name: "correct_patient_service",
        args: {
          p_id: id,
          p_pet_id: petId,
          p_event_id: parsed.eventId,
          p_reason: parsed.reason,
          p_replacement_id: parsed.replacementId || null,
        },
      });
    } catch (failure) {
      setError(
        failure instanceof z.ZodError
          ? failure.issues[0].message
          : errorMessage(failure),
      );
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Performed services</CardTitle>
        <p className="text-sm text-muted-foreground">
          Record completed care separately from billing. Original entries and
          corrections remain in the patient history.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {history.isPending && <p role="status">Loading services…</p>}
        {history.isError && (
          <p role="alert" className="text-destructive">
            {errorMessage(history.error)}{" "}
            <button
              className="underline"
              onClick={() => void history.refetch()}
            >
              Retry
            </button>
          </p>
        )}
        {!history.data?.length && history.isSuccess && (
          <p className="text-sm text-muted-foreground">
            No performed services recorded.
          </p>
        )}
        <div className="space-y-2">
          {history.data?.map((s) => (
            <article
              key={s.id}
              id={`service-${s.id}`}
              className={`rounded-md border p-3 ${params.get("event") === s.id ? "ring-2 ring-primary" : ""}`}
            >
              <p className="font-medium">
                {s.product_name}{" "}
                {s.correction && (
                  <Badge variant="outline">Corrected original</Badge>
                )}
              </p>
              <p className="text-sm">
                {denverDateTime(s.performed_at).replace("T", " ")} (Denver) ·{" "}
                {s.clinician_name}
              </p>
              {s.notes && (
                <p className="whitespace-pre-wrap break-words text-sm">
                  {s.notes}
                </p>
              )}
              <p className="break-all text-xs text-muted-foreground">
                Service {s.id} · Encounter {s.encounter_id}
              </p>
              {s.correction ? (
                <p className="text-sm">
                  Correction: {s.correction.reason}
                  {s.correction.replacement_id &&
                    ` · Replacement ${s.correction.replacement_id}`}
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !!pending || !!correctionId}
                  onClick={() => {
                    setCorrectionId(s.id);
                    setReason("");
                    setReplacementId("");
                  }}
                >
                  Correct service entry
                </Button>
              )}
            </article>
          ))}
        </div>
        {correctionId && (
          <fieldset
            disabled={busy || !!pending}
            className="space-y-3 border-t pt-3"
          >
            <legend className="text-sm font-semibold">
              Correct recorded service
            </legend>
            <p className="break-all text-xs">Original: {correctionId}</p>
            <Label htmlFor="service-reason">Correction reason</Label>
            <Textarea
              id="service-reason"
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
            <Label htmlFor="service-replacement">
              Replacement service (optional)
            </Label>
            <select
              id="service-replacement"
              className={selectClass}
              value={replacementId}
              onChange={(e) => setReplacementId(e.target.value)}
            >
              <option value="">No replacement; exclude original</option>
              {history.data
                ?.filter(
                  (s) =>
                    s.id !== correctionId &&
                    !s.correction &&
                    s.encounter_id ===
                      history.data?.find(
                        (original) => original.id === correctionId,
                      )?.encounter_id,
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.product_name} · {denverDateTime(s.performed_at)} · {s.id}
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!reason.trim()} onClick={correct}>
                Save correction
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setCorrectionId("");
                  setReason("");
                  setReplacementId("");
                }}
              >
                Cancel correction
              </Button>
            </div>
          </fieldset>
        )}
        {!encounterId && (
          <p className="text-sm text-muted-foreground">
            Select or save an encounter below to record a completed service.
          </p>
        )}
        {encounterId && !disabled && (
          <fieldset
            disabled={busy || !!pending || !!correctionId}
            className="space-y-3 border-t pt-4"
          >
            <legend className="font-medium">Record a completed service</legend>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="service-search">Find service</Label>
                <Input
                  id="service-search"
                  value={needle}
                  maxLength={200}
                  onChange={(e) => setNeedle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-product">Service catalog item</Label>
                <select
                  id="service-product"
                  className={selectClass}
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">Choose service</option>
                  {productId &&
                    !products.data?.some((p) => p.id === productId) && (
                      <option value={productId}>
                        Selected service · {productId}
                      </option>
                    )}
                  {products.data
                    ?.filter((p) => p.kind === "service" && p.active)
                    .slice(0, 100)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-clinician">Performing clinician</Label>
                <select
                  id="service-clinician"
                  className={selectClass}
                  value={clinicianId}
                  onChange={(e) => setClinicianId(e.target.value)}
                >
                  <option value="">Choose clinician</option>
                  {clinicians.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-time">Completed at (Denver)</Label>
                <Input
                  id="service-time"
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </div>
            </div>
            {(products.isError || clinicians.isError) && (
              <p role="alert" className="text-destructive">
                Service choices could not load.{" "}
                <button
                  className="underline"
                  onClick={() => {
                    void products.refetch();
                    void clinicians.refetch();
                  }}
                >
                  Retry choices
                </button>
              </p>
            )}
            {(products.data?.length ?? 0) > 100 && (
              <p className="text-xs text-muted-foreground">
                Refine the service name to see more catalog items.
              </p>
            )}
            <Label htmlFor="service-notes">Service notes</Label>
            <Textarea
              id="service-notes"
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button disabled={!productId || !clinicianId} onClick={record}>
              Record service completion
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setProductId("");
                setClinicianId("");
                setNotes("");
                setWhen(initialTime.current);
                setNeedle("");
              }}
            >
              Clear service draft
            </Button>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {pending && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm">
              The response was interrupted. Retry the same saved request to
              confirm its outcome.
            </p>
            <Button
              disabled={busy || session?.user.id !== pending.actorId}
              onClick={() => void send(pending)}
            >
              {busy ? "Saving…" : "Retry exact service request"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
