import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { downloadReviewedOriginal } from "./attachment-chart-api";
import { captureRpc } from "./attachment-capture-api";
import { parseAttachmentChart } from "./attachment-chart-state";
import type { ReviewCursor } from "./attachment-review-history";
interface Props {
  petId: string;
  disabled: boolean;
}
export function PatientApiAttachments(props: Props) {
  const { session } = useAuth();
  return session ? (
    <Chart
      key={`${session.user.id}:${props.petId}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
interface ChartProps extends Props {
  actor: string;
}
function Chart({ petId, disabled, actor }: ChartProps) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    lock = useRef(false),
    urls = useRef<string[]>([]),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      generation.current++;
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = [];
    };
    const auth = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actor) {
        alive.current = false;
        clear();
      }
    });
    window.addEventListener("pagehide", clear);
    return () => {
      alive.current = false;
      clear();
      auth.data.subscription.unsubscribe();
      window.removeEventListener("pagehide", clear);
    };
  }, [actor]);
  async function download(id: string, hash: string) {
    if (lock.current || disabled || !alive.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    const epoch = generation.current;
    try {
      const file = await downloadReviewedOriginal(actor, petId, id, hash);
      if (!alive.current || epoch !== generation.current) return;
      const url = URL.createObjectURL(file.blob);
      urls.current.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.rel = "noopener noreferrer";
      link.click();
      setNotice(
        "Reviewed original downloaded after byte verification. Release remains a separate decision.",
      );
    } catch {
      if (alive.current && epoch === generation.current)
        setNotice(
          "The reviewed original could not be verified. No download is available.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const [cursor, setCursor] = useState<ReviewCursor | null>(null);
  const [authorized, setAuthorized] = useState(true);
  useEffect(() => {
    const auth = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actor) setAuthorized(false);
    });
    return () => auth.data.subscription.unsubscribe();
  }, [actor]);
  const history = useQuery({
    queryKey: ["patient-api-attachments", actor, petId, cursor],
    enabled: authorized,
    retry: false,
    queryFn: async () => {
      const before = await supabase.auth.getSession();
      if (before.error) throw before.error;
      if (before.data.session?.user.id !== actor)
        throw new Error("Session changed");
      const result = await captureRpc("read_ezyvet_attachment_chart", {
        p_pet_id: petId,
        p_before_at: cursor?.before_at ?? null,
        p_before_id: cursor?.before_id ?? null,
        p_limit: 20,
      });
      const after = await supabase.auth.getSession();
      if (after.error) throw after.error;
      if (after.data.session?.user.id !== actor)
        throw new Error("Session changed");
      return parseAttachmentChart(result, petId, cursor);
    },
  });
  if (!authorized) return null;
  return (
    <Card role="region" aria-label="Reviewed API attachments">
      <CardHeader>
        <CardTitle className="text-lg">Reviewed API attachments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Staff-reviewed ezyVet source files. Earlier approvals remain in this
          history. A saved approval does not establish that all outside records
          were imported or authorize a release.
        </p>
        {notice && <p role="status">{notice}</p>}
        {history.isFetching && (
          <p role="status">Loading reviewed attachments…</p>
        )}
        {history.isError && (
          <p role="alert">
            Reviewed attachment history could not be verified. Recheck to try
            again.
          </p>
        )}
        {!history.isError && history.data?.records.length === 0 && (
          <p>No reviewed API attachments on this page.</p>
        )}
        {!history.isError && (
          <ul className="space-y-3">
            {history.data?.records.map(
              ({ record: r, is_latest, source_current }) => (
                <li key={r.id} className="space-y-2 rounded-md border p-3">
                  <h3 className="font-medium">
                    {r.title} · Version {r.version}
                  </h3>
                  <p className="text-sm">
                    {is_latest
                      ? "Latest saved approval"
                      : "Superseded approval"}{" "}
                    · {new Date(r.created_at).toLocaleString()}
                  </p>
                  <p className="text-sm">
                    {source_current
                      ? "Source observation still matches."
                      : "Source changed or is unavailable. Review required."}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {r.review_reason}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ezyVet API attachment {r.attachment_external_id}
                  </p>
                  <Button
                    variant="outline"
                    disabled={disabled || busy || history.isFetching}
                    onClick={() => void download(r.id, r.capture_hash)}
                  >
                    Download verified original version {r.version}
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={disabled || busy || history.isFetching}
            onClick={() => void history.refetch()}
          >
            Recheck reviewed attachments
          </Button>
          <Button
            variant="outline"
            disabled={disabled || busy || history.isFetching || !cursor}
            onClick={() => setCursor(null)}
          >
            Newest reviewed attachments
          </Button>
          <Button
            variant="outline"
            disabled={
              disabled ||
              history.isFetching ||
              history.isError ||
              !history.data?.next_cursor
            }
            onClick={() => setCursor(history.data!.next_cursor)}
          >
            Older reviewed attachments
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
