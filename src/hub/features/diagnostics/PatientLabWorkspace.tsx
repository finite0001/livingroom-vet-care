import { useEffect, useState } from "react";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PatientLabWork } from "../lab-work/PatientLabWork";
import { PatientDiagnostics } from "./PatientDiagnostics";
interface Props {
  petId: string;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
/** One patient navigation signal combines both editors; peer editors cannot overwrite it. */
export function PatientLabWorkspace({ petId, disabled, onDirtyChange }: Props) {
  const { session } = useAuth();
  const actor = session?.user.id ?? "";
  const preference = `lrv:diagnostics-open:${actor}:${petId}`;
  const [opened, setOpened] = useState(() => {
    try {
      return (
        sessionStorage.getItem(preference) === "true" ||
        Boolean(
          sessionStorage.getItem(`lrv:diagnostic-action:${actor}:${petId}`),
        )
      );
    } catch {
      return false;
    }
  });
  const [labDirty, setLabDirty] = useState(false),
    [diagnosticDirty, setDiagnosticDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(labDirty || diagnosticDirty);
    return () => onDirtyChange(false);
  }, [labDirty, diagnosticDirty, onDirtyChange]);
  return (
    <div className="space-y-5">
      {opened ? (
        <PatientDiagnostics
          petId={petId}
          disabled={disabled || labDirty}
          onDirtyChange={setDiagnosticDirty}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>In-house diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Record numeric or qualitative findings, review corrections and
              compare compatible results over time.
            </p>
            <Button
              disabled={disabled || labDirty}
              onClick={() => {
                try {
                  sessionStorage.setItem(preference, "true");
                } catch {
                  /* Optional view preference; opening is still available. */
                }
                setOpened(true);
              }}
            >
              Open in-house diagnostics
            </Button>
          </CardContent>
        </Card>
      )}
      <fieldset disabled={disabled || diagnosticDirty}>
        <legend className="sr-only">
          Laboratory orders and original reports
        </legend>
        <PatientLabWork petId={petId} onDirtyChange={setLabDirty} />
      </fieldset>
    </div>
  );
}
