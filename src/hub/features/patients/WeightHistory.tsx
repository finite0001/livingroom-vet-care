import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { practiceToday, weightInKg } from "./patient-details";
import { toast } from "sonner";

interface WeightHistoryProps {
  petId: string;
  legacyWeight: number | null;
  disabled: boolean;
}
export function WeightHistory({
  petId,
  legacyWeight,
  disabled,
}: WeightHistoryProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("kg");
  const [date, setDate] = useState(practiceToday);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [saveError, setSaveError] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["patient-weights", petId, session?.user.id],
    enabled: !!session,
    initialPageParam: null as { date: string; at: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      let request = supabase
        .from("patient_weights")
        .select("*")
        .eq("pet_id", petId)
        .order("measured_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50);
      if (pageParam)
        request = request.or(
          `measured_at.lt.${pageParam.date},and(measured_at.eq.${pageParam.date},created_at.lt.${pageParam.at}),and(measured_at.eq.${pageParam.date},created_at.eq.${pageParam.at},id.lt.${pageParam.id})`,
        );
      const { data, error } = await request;
      if (error) throw error;
      const provenance = await supabase.rpc("read_weight_import_provenance", {
        p_pet_id: petId,
        p_weight_ids: data.map((w) => w.id),
      });
      if (provenance.error) throw provenance.error;
      return data.map((w) => ({
        ...w,
        provenance: provenance.data.filter((p) => p.weight_id === w.id),
      }));
    },
    getNextPageParam: (last) =>
      last.length === 50
        ? {
            date: last.at(-1)!.measured_at,
            at: last.at(-1)!.created_at,
            id: last.at(-1)!.id,
          }
        : undefined,
  });
  const measurements = query.data?.pages.flat() ?? [];
  const record = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pendingRef.current || disabled) return;
    if (!session?.user.id) {
      setSaveError("Sign in again to record a weight.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setSaveError("");
    try {
      const { error } = await supabase.rpc("record_patient_weight", {
        p_pet_id: petId,
        p_weight: Number(weight),
        p_unit: unit,
        p_measured_at: date,
      });
      if (error) throw error;
      setWeight("");
      await cache.invalidateQueries({ queryKey: ["patient-weights", petId] });
      toast.success("Weight recorded");
    } catch (cause) {
      setSaveError(
        cause && typeof cause === "object" && "message" in cause
          ? String(cause.message)
          : "Weight could not be saved. Your entries are still here.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Weight history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <p role="status">Loading weights…</p>
        ) : query.isError ? (
          <div role="alert">
            <p className="text-destructive">
              Weight history could not be loaded.
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry weights
            </Button>
          </div>
        ) : measurements.length ? (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Recorded patient weights with measurement dates
              </caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2">
                    Measured
                  </th>
                  <th scope="col">Weight</th>
                  <th scope="col">Equivalent</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((measurement) => (
                  <tr key={measurement.id} className="border-b">
                    <td className="py-2">{measurement.measured_at}</td>
                    <td>
                      {measurement.weight} {measurement.unit}
                    </td>
                    <td className="text-muted-foreground">
                      {measurement.unit === "lb"
                        ? `${weightInKg(measurement.weight, "lb").toFixed(2)} kg`
                        : `${(measurement.weight / 0.45359237).toFixed(2)} lb`}
                    </td>
                    <td>
                      {measurement.provenance.length ? (
                        <details>
                          <summary>Reviewed ezyVet history</summary>
                          {measurement.provenance.map((source) => (
                            <div key={source.source_record_id}>
                              <p>
                                Source record #{source.source_record_id}:{" "}
                                {source.source_weight} {source.source_unit};
                                original source timestamp{" "}
                                {source.source_timestamp || "unknown"}.
                              </p>
                              <p>
                                Reviewed by {source.reviewer_name} on{" "}
                                {new Date(source.reviewed_at).toLocaleString()}.
                                Reviewer is not necessarily the source
                                clinician.
                              </p>
                            </div>
                          ))}
                        </details>
                      ) : (
                        "Recorded in Living Room Vet"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No dated weight measurements yet.
            {legacyWeight != null
              ? ` Legacy profile weight: ${legacyWeight} lb (measurement date unknown).`
              : ""}
          </p>
        )}
        {query.hasNextPage && (
          <Button
            disabled={query.isFetchingNextPage}
            variant="outline"
            onClick={() => void query.fetchNextPage()}
          >
            Load older measurements
          </Button>
        )}
        {!disabled && (
          <form onSubmit={record} className="space-y-3">
            <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="weight-value">Weight</Label>
                <Input
                  id="weight-value"
                  type="number"
                  min="0.001"
                  max="10000"
                  step="any"
                  required
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="weight-unit">Unit</Label>
                <select
                  id="weight-unit"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  <option value="kg">kg</option>
                  <option value="lb">lb</option>
                </select>
              </div>
              <div>
                <Label htmlFor="weight-date">Measured on</Label>
                <Input
                  id="weight-date"
                  type="date"
                  required
                  max={practiceToday()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </fieldset>
            {saveError && (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            )}
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Recording…" : "Record weight"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
