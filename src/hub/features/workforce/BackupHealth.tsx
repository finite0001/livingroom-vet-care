import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { clinicalCall } from "../clinical-tools/api";
const schema = z.array(
  z.object({
    id: z.string().uuid(),
    started_at: z.iso.datetime({ offset: true }),
    finished_at: z.iso.datetime({ offset: true }),
    status: z.enum(["SUCCEEDED", "FAILED", "NAS_PENDING"]),
    object_count: z.number(),
    encrypted_bytes: z.number(),
    archive_sha256: z.string().nullable(),
    failure_code: z.string().nullable(),
  }),
);
export function BackupHealth() {
  const query = useQuery({
    queryKey: ["staff-backup-health"],
    queryFn: async () =>
      schema.parse(await clinicalCall("read_staff_backups", {})),
  });
  const latest = query.data?.[0];
  const overdue =
    latest && Date.now() - Date.parse(latest.finished_at) > 36 * 3600000;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-display text-xl">Automatic backup health</h2>
      <p className="text-sm text-muted-foreground">
        Encrypted database and physical document backup receipts. A successful
        upload is separate from a tested restore.
      </p>
      {query.isPending ? (
        <p>Checking backup receipts…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Backup state is unknown: {query.error.message}</p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : !latest ? (
        <p>
          No automated backup receipt yet. Destination, encryption key and
          scheduled workflow need setup.
        </p>
      ) : (
        <>
          <p
            className={
              latest.status === "FAILED" || overdue
                ? "font-medium text-destructive"
                : "font-medium"
            }
          >
            {overdue
              ? "Overdue — last receipt is older than 36 hours"
              : latest.status === "SUCCEEDED"
                ? "Latest encrypted backup uploaded"
                : latest.status === "NAS_PENDING"
                  ? "Google Drive verified; NAS copy staged for Synology sync"
                  : "Latest backup failed"}
          </p>
          {query.data?.map((run) => (
            <div key={run.id} className="rounded border p-3 text-sm">
              <p>
                {new Date(run.finished_at).toLocaleString("en-US", {
                  timeZone: "America/Denver",
                })}{" "}
                · {run.status} · {run.object_count} files ·{" "}
                {(run.encrypted_bytes / 1048576).toFixed(1)} MB encrypted
              </p>
              {run.failure_code && <p>{run.failure_code}</p>}
              {run.archive_sha256 && (
                <p className="break-all text-xs text-muted-foreground">
                  Archive checksum: {run.archive_sha256}
                </p>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
