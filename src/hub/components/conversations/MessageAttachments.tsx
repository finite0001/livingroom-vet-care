import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { readMessageAttachment, type MessageAttachmentHistory } from "@/hub/features/communications/message-attachments";
interface MessageAttachmentsProps { history: MessageAttachmentHistory }
export function MessageAttachments({ history }: MessageAttachmentsProps) {
  const { session } = useAuth();
  const actor = session?.user.id ?? null;
  const current = useRef(actor);
  current.current = actor;
  useEffect(() => { current.current = actor; return () => { current.current = null; }; }, [actor]);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const download = async (uploadId: string) => {
    if (!actor || working.current) return;
    working.current = true; setBusy(true); setError(null);
    try {
      const blob = await readMessageAttachment(supabase, actor, () => current.current, history, uploadId);
      const file = history.files.find(file => file.uploadId === uploadId)!;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.name; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (cause) {
      if (current.current === actor) setError(cause instanceof Error ? cause.message : "Attachment could not be opened.");
    } finally { working.current = false; if (current.current === actor) setBusy(false); }
  };
  return <div className="mt-2 space-y-1">
    <ul aria-label="Message attachments" className="space-y-1">
      {history.files.map(file => <li key={file.uploadId}>
        <Button variant="link" size="sm" className="h-auto max-w-full justify-start whitespace-normal px-0 text-left" disabled={busy} onClick={() => void download(file.uploadId)}>
          <Paperclip aria-hidden="true" className="mr-1 h-3 w-3 shrink-0" /><span className="break-all">{file.name}</span><span className="ml-2 shrink-0 text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
        </Button>
      </li>)}
    </ul>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
