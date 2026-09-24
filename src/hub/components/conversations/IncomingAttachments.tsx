import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { verifyIncomingDownload, type IncomingAttachment } from "@/hub/features/communications/incoming-attachments";
interface IncomingAttachmentsProps { files: IncomingAttachment[] }
export function IncomingAttachments({ files }: IncomingAttachmentsProps) {
  const { session } = useAuth();
  const actor = session?.user.id ?? null;
  const current = useRef(actor); current.current = actor;
  useEffect(() => { current.current = actor; return () => { current.current = null; }; }, [actor]);
  const queryClient = useQueryClient();
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (file: IncomingAttachment) => {
    if (!actor || working.current || file.status === "unsupported") return;
    working.current = true; setBusy(true); setError(null);
    try {
      if (file.status === "capturing") return;
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (current.current !== actor || data.session?.user.id !== actor) throw new Error("Staff session changed.");
      if (file.status === "pending") {
        const { error: captureError } = await supabase.functions.invoke("capture-inbound-attachment", {
          body: { inbound_id: file.inboundId, attachment_id: file.attachmentId, version: file.version },
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (captureError) throw new Error("File retrieval is unconfirmed. Check its status before trying again.");
      } else {
        // Fetch the response as bytes; FunctionsClient defaults image MIME types to text.
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/read-inbound-attachment`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ capture_id: file.captureId, message_id: file.messageId }),
          credentials: "omit", cache: "no-store", redirect: "error",
        });
        if (!response.ok) throw new Error("This file is currently unavailable. Refresh its status and try again.");
        const blob = await verifyIncomingDownload(await response.blob(), file, actor, () => current.current);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = file.name.replace(/[\\/]/g, "_"); document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (cause) {
      if (current.current === actor) setError(cause instanceof Error ? cause.message : "Incoming file is unavailable.");
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["incoming-attachments", actor] });
      working.current = false; if (current.current === actor) setBusy(false);
    }
  };
  return <div className="mt-2 space-y-1">
    <ul aria-label="Incoming attachments" className="space-y-2">
      {files.map((file, index) => <li key={`${file.inboundId}:${file.attachmentId ?? index}`} className="text-sm">
        <div className="flex items-start gap-1"><Paperclip aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" /><span className="break-all">{file.name}</span></div>
        <div className="flex flex-wrap items-center gap-x-2 pl-4 text-xs text-muted-foreground">
          {file.size !== null && <span>{(file.size / 1024).toFixed(1)} KB</span>}
          <span>{file.status === "ready" ? "Verified file" : file.status === "capturing" ? "Retrieval in progress" : file.status === "unsupported" ? "File retrieval unavailable" : "Not yet retrieved"}</span>
          {file.status !== "unsupported" && <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={() => void act(file)}>
            {file.status === "ready" ? "Download" : file.status === "capturing" ? "Check status" : "Retrieve file"}
          </Button>}
        </div>
      </li>)}
    </ul>
    {error && <div className="text-xs">
      <p role="alert" className="text-destructive">{error}</p>
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={() => void queryClient.invalidateQueries({ queryKey: ["incoming-attachments", actor] })}>Refresh file status</Button>
    </div>}
  </div>;
}
