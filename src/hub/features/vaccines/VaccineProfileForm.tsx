import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, isDefinitiveRejection } from "../inventory/stock-policy";
import {
  readVaccineProfiles,
  saveVaccineProfile,
  type SaveVaccineProfileArgs,
} from "./api";
import { labeledDurations, vaccineProfileArgs } from "./vaccine-status";
import { vaccineProfileQueryKey } from "./profile-display";

const selectClass =
  "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm";

interface VaccineProfileFormProps {
  productId: string;
  productName: string;
}

export function VaccineProfileForm({
  productId,
  productName,
}: VaccineProfileFormProps) {
  const { hasRole } = useAuth();
  const canEdit = hasRole("ADMIN") || hasRole("DVM");
  const cache = useQueryClient();
  const profile = useQuery({
    queryKey: vaccineProfileQueryKey([productId]),
    queryFn: () => readVaccineProfiles([productId]),
  });
  const pending = useRef<SaveVaccineProfileArgs | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  if (profile.isPending)
    return <p role="status">Loading vaccine information…</p>;
  if (profile.isError)
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(profile.error)}
      </p>
    );
  const current = profile.data[0];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSaved("");
    try {
      if (!pending.current) {
        const v = new FormData(event.currentTarget);
        pending.current = {
          p_product_id: productId,
          p_expected_version: current?.version ?? null,
          ...vaccineProfileArgs({
            group_key: String(v.get("group_key") ?? ""),
            species: String(v.get("species") ?? ""),
            vaccine_type: String(v.get("vaccine_type") ?? ""),
            labeled_duration: String(v.get("labeled_duration") ?? ""),
            default_booster_interval_days: String(v.get("interval") ?? ""),
            review_note: String(v.get("review_note") ?? ""),
          }),
        };
      }
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    setBusy(true);
    try {
      await saveVaccineProfile(pending.current);
      pending.current = null;
      setUncertain(false);
      setSaved("Vaccine information saved.");
      await cache.invalidateQueries({
        queryKey: ["inventory", "vaccine-profiles"],
      });
    } catch (failure) {
      const definitive = isDefinitiveRejection(failure);
      if (definitive) pending.current = null;
      setUncertain(!definitive);
      setError(
        errorMessage(failure) +
          (definitive
            ? ""
            : " Outcome unconfirmed. Retry sends the same request."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      key={current?.version ?? 0}
      onSubmit={submit}
      className="space-y-3 rounded-md border p-3"
      aria-label={`Vaccine information for ${productName}`}
    >
      <h3 className="font-semibold">Vaccine information</h3>
      <p className="text-xs text-muted-foreground">
        Optional product-label facts. The default interval only offers a
        pre-fill when recording an administration; the clinician chooses the
        due date. Pending clinical review — no values are pre-loaded.
      </p>
      <fieldset
        disabled={!canEdit || busy || uncertain}
        className="grid min-w-0 gap-3 md:grid-cols-2"
      >
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${productId}-group`}>
            Vaccine group key (e.g. matches a due-plan group)
          </Label>
          <Input
            id={`${productId}-group`}
            name="group_key"
            maxLength={80}
            defaultValue={current?.group_key ?? ""}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${productId}-species`}>
            Labeled species (comma separated)
          </Label>
          <Input
            id={`${productId}-species`}
            name="species"
            maxLength={900}
            defaultValue={current?.species.join(", ") ?? ""}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${productId}-type`}>Vaccine type / formulation</Label>
          <Input
            id={`${productId}-type`}
            name="vaccine_type"
            maxLength={200}
            defaultValue={current?.vaccine_type ?? ""}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${productId}-duration`}>
            Labeled product duration
          </Label>
          <select
            id={`${productId}-duration`}
            name="labeled_duration"
            className={selectClass}
            defaultValue={current?.labeled_duration ?? ""}
          >
            <option value="">Not recorded</option>
            {labeledDurations.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${productId}-interval`}>
            Default booster interval (days, optional)
          </Label>
          <Input
            id={`${productId}-interval`}
            name="interval"
            inputMode="numeric"
            defaultValue={current?.default_booster_interval_days ?? ""}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${productId}-note`}>
            Label source / reviewer (required)
          </Label>
          <Input
            id={`${productId}-note`}
            name="review_note"
            required
            maxLength={2000}
            defaultValue={current?.review_note ?? ""}
          />
        </div>
      </fieldset>
      {current && (
        <p className="text-xs text-muted-foreground">
          Version {current.version} · updated {current.updated_at}
        </p>
      )}
      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          A veterinarian or administrator records vaccine information.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {saved}
        </p>
      )}
      {canEdit && (
        <Button variant="outline" disabled={busy}>
          {uncertain ? "Retry same vaccine information" : "Save vaccine information"}
        </Button>
      )}
    </form>
  );
}
