import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hub/contexts/auth-context";
import { useContextMutation } from "../useContextMutation";
import { errorMessage, practiceTimestamp } from "../stock-policy";
import { readRestockAlerts, saveRestockSetting } from "./api";
import { restockState, thresholdSchema, settingSchema } from "./model";
function useRestock() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["inventory", "restock", session?.user.id],
    enabled: !!session,
    queryFn: readRestockAlerts,
    refetchInterval: 30_000,
  });
}
export function RestockAlerts({ compact = false }: { compact?: boolean }) {
  const query = useRestock();
  const low = query.data?.rows.filter((r) => restockState(r) === "low") ?? [];
  const uncounted =
    query.data?.rows.filter((r) => restockState(r) === "uncounted") ?? [];
  return (
    <section
      id={compact ? undefined : "restocking"}
      aria-label="Restocking alerts"
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h2 className="font-display text-lg">Restocking alerts</h2>
      {query.isPending && <p role="status">Checking stock…</p>}
      {query.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {query.data && (
        <>
          <p>
            {low.length} {low.length === 1 ? "product needs" : "products need"}{" "}
            restocking.
            {uncounted.length > 0 &&
              ` ${uncounted.length} awaiting an opening count.`}
          </p>
          {!compact && (
            <>
              <p className="text-sm text-muted-foreground">
                Practice-wide unexpired ledger stock, across all locations. Held
                or quarantined stock is included; these counts do not establish
                permission to dispense. Alerts appear at or below your chosen
                threshold. Set thresholds by editing an exact product below.
              </p>
              {!query.data.rows.some((r) => r.threshold !== null) && (
                <p>No restocking thresholds enabled yet.</p>
              )}
              {[...low, ...uncounted].map((r) => (
                <article key={r.id} className="rounded-md border p-3">
                  <p className="font-medium">{r.name}</p>
                  <p>
                    {restockState(r) === "uncounted"
                      ? "Opening count needed"
                      : `${r.balance} ${r.unit} remaining`}{" "}
                    · Restock at {r.threshold} {r.unit}
                  </p>
                  <Button asChild variant="outline" className="mt-2 min-h-11">
                    <Link to={`/hub/whogot?product=${r.id}`}>
                      View patient usage
                    </Link>
                  </Button>
                </article>
              ))}
              <p className="text-xs text-muted-foreground">
                Checked {practiceTimestamp(query.data.as_of)} · refreshes every
                30 seconds.
              </p>
            </>
          )}
          {compact && (
            <Button asChild variant="outline">
              <Link to="/hub/inventory#restocking">Review inventory</Link>
            </Button>
          )}
        </>
      )}
    </section>
  );
}
interface RestockSettingsProps {
  productId: string;
  productName: string;
  unit: string;
}
export function RestockSettings({
  productId,
  productName,
  unit,
}: RestockSettingsProps) {
  const query = useRestock();
  const { session } = useAuth();
  const state = useContextMutation(
    `restock:${productId}`,
    async (_name, args) => saveRestockSetting(settingSchema.parse(args)),
  );
  const [validation, setValidation] = useState("");
  const id = useId();
  const setting = query.data?.rows.find((r) => r.id === productId);
  return (
    <form
      key={`${productId}:${setting?.version ?? 0}`}
      className="space-y-3 rounded-md border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setValidation("");
        if (state.uncertain) {
          await state.retry();
          return;
        }
        try {
          const raw = String(
            new FormData(e.currentTarget).get("threshold") ?? "",
          ).trim();
          await state.run({
            name: "save_inventory_restock_setting",
            args: settingSchema.parse({
              p_actor_id: session?.user.id,
              p_product_id: productId,
              p_threshold: raw ? thresholdSchema.parse(raw) : null,
              p_expected_version: setting?.version ?? 0,
            }),
          });
        } catch (error) {
          setValidation(errorMessage(error));
        }
      }}
    >
      <h3 className="font-medium">Restocking: {productName}</h3>
      <Label htmlFor={id}>Alert at or below ({unit})</Label>
      <Input
        id={id}
        name="threshold"
        inputMode="decimal"
        defaultValue={setting?.threshold ?? ""}
        disabled={state.busy || state.uncertain || !query.isSuccess}
      />
      <p className="text-sm text-muted-foreground">
        Blank disables alerts. Zero alerts when unexpired ledger stock reaches
        zero. Receive an opening count before relying on alerts.
      </p>
      {(validation || state.error) && (
        <p role="alert" className="text-destructive">
          {validation || state.error}
        </p>
      )}
      {query.error && (
        <p role="alert">
          Could not load current threshold.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          Restocking setting saved.
        </p>
      )}
      <Button disabled={state.busy || !query.isSuccess}>
        {state.uncertain ? "Retry same threshold" : "Save restocking threshold"}
      </Button>
    </form>
  );
}
