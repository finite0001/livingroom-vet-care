import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { loadAttachmentOriginal } from "./attachment-file-api";
import type { AttachmentFileIntent } from "./attachment-file-state";
interface Props { intent: AttachmentFileIntent; disabled: boolean; onBusy: (busy: boolean) => void; }
interface Original { url: string; filename: string; captureHash: string; }
export function AttachmentOriginal({ intent, disabled, onBusy }: Props) {
  const [original, setOriginal] = useState<Original | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const url = useRef<string | null>(null), generation = useRef(0), lock = useRef(false), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const clear = () => { generation.current++; if (url.current) URL.revokeObjectURL(url.current); url.current = null; if (alive.current) setOriginal(null); };
    const auth = supabase.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_OUT" || !session || session.user.id !== intent.actor) clear(); });
    window.addEventListener("pagehide", clear);
    return () => { alive.current = false; clear(); auth.data.subscription.unsubscribe(); window.removeEventListener("pagehide", clear); onBusy(false); };
  }, [intent.actor, onBusy]);
  async function inspect() {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); onBusy(true); setNotice(""); setOriginal(null);
    if (url.current) URL.revokeObjectURL(url.current); url.current = null;
    const current = ++generation.current;
    try {
      const result = await loadAttachmentOriginal(intent);
      if (!alive.current || generation.current !== current) return;
      url.current = URL.createObjectURL(result.blob);
      setOriginal({ url: url.current, filename: result.filename, captureHash: result.captureHash });
      setNotice("The private original matches its saved size, file type and SHA-256. Download and inspect it before clinical review; this check is not approval.");
    } catch { if (alive.current && generation.current === current) setNotice("The private original could not be verified. No download is available. Recheck the captured file and your access before trying again."); }
    finally { lock.current = false; if (alive.current) { setBusy(false); onBusy(false); } }
  }
  return <section aria-label="Captured original inspection" className="space-y-2 border-t pt-3">
    <h4 className="text-sm font-medium">Captured original inspection</h4>
    <p className="text-sm text-muted-foreground">This is the immutable API source copy. Inspection does not approve it for the clinical record or a release.</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || disabled} onClick={() => void inspect()}>{busy ? "Verifying private original…" : "Verify original for inspection"}</Button>
      {original && <a className={buttonVariants({ variant: "secondary" })} href={original.url} download={original.filename} rel="noopener noreferrer">Download verified original</a>}
    </div>
  </section>;
}
