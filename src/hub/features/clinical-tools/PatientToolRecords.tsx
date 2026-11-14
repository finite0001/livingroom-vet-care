import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import { readClinicalTools } from "./api";
interface PatientToolRecordsProps {
  petId: string;
}
export function PatientToolRecords({ petId }: PatientToolRecordsProps) {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: ["clinical-tools", session?.user.id, petId],
    queryFn: () => readClinicalTools(petId),
  });
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-display text-xl">
        Clinical worksheets & approved drafts
      </h2>
      <Link
        className="text-sm underline"
        to={`/hub/tools/clinical?pet=${petId}`}
      >
        Open clinical tools for this patient
      </Link>
      {query.isPending ? (
        <p>Loading clinical artifacts…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Clinical tool artifacts could not be loaded.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {query.data.calculations.length === 0 &&
            query.data.helpers.filter((j) => j.state === "APPROVED").length ===
              0 && (
              <p className="text-sm text-muted-foreground">
                No saved worksheets or approved helper drafts.
              </p>
            )}
          {query.data.calculations.map((c) => (
            <details key={c.id} className="rounded border p-3">
              <summary>
                {c.tool} worksheet ·{" "}
                {new Date(c.created_at).toLocaleDateString("en-US", {
                  timeZone: "America/Denver",
                })}
              </summary>
              <dl>
                {Object.entries(c.result.values).map(([key, value]) => (
                  <div key={key} className="mt-2">
                    <dt className="text-sm text-muted-foreground">
                      {key.replace(/_/g, " ")}
                    </dt>
                    <dd>
                      {typeof value === "number"
                        ? Number(value.toFixed(3))
                        : value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
          {query.data.helpers
            .filter((j) => j.state === "APPROVED")
            .map((j) => (
              <details key={j.id} className="rounded border p-3">
                <summary>
                  {j.kind} · veterinarian-approved{" "}
                  {j.reviewed_at &&
                    new Date(j.reviewed_at).toLocaleDateString("en-US", {
                      timeZone: "America/Denver",
                    })}
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {j.reviewed_text}
                </p>
              </details>
            ))}
        </>
      )}
    </section>
  );
}
