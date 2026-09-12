import { useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MessageSquare, StickyNote, Mail } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateSelector } from "./TemplateSelector";
import { cn } from "@/lib/utils";

export interface AttachmentFile { file: File; id: string; }

interface ReplyComposerProps {
  onSend: (content: string, channel: "SMS" | "EMAIL" | "NOTE", subject?: string, attachments?: AttachmentFile[], cc?: string[], includeSignature?: boolean) => Promise<boolean>;
  defaultChannel?: "SMS" | "EMAIL" | "NOTE";
  smsOptedOut?: boolean;
  draft?: string;
  onDraftConsumed?: () => void;
  disabled?: boolean;
}

const SMS_SEGMENT_LENGTH = 160;

export function ReplyComposer({ onSend, defaultChannel, smsOptedOut, draft, onDraftConsumed, disabled }: ReplyComposerProps) {
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = pending || disabled;
  // Only populate from a suggestion/draft when the composer is empty, so tapping a
  // smart-reply can never silently overwrite a reply the staffer is mid-typing.
  useEffect(() => {
    if (!draft || pendingRef.current) return;
    if (!content.trim()) setContent(draft);
    // Consume rejected suggestions too, so clearing a typed reply cannot revive one.
    onDraftConsumed?.();
  }, [draft, content, onDraftConsumed, pending]);

  const [channel, setChannel] = useState<"SMS" | "EMAIL" | "NOTE">(defaultChannel || "SMS");
  const [subject, setSubject] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Consent loads async after first paint; if it resolves to opted-out while the
  // SMS tab is selected AND the draft is still empty, move off it so staff can't
  // sit on a disabled channel. We only switch when empty so a half-typed client
  // message is never silently re-labeled as an internal NOTE — a typed SMS to an
  // opted-out client is instead blocked with a toast by the send handler.
  useEffect(() => {
    if (smsOptedOut && channel === "SMS" && !content) setChannel("NOTE");
  }, [smsOptedOut, channel, content]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => { autoResize(); }, [channel, content, autoResize]);

  const smsSegments = channel === "SMS" ? Math.ceil(content.length / SMS_SEGMENT_LENGTH) : 0;

  const emailMissingSubject = channel === "EMAIL" && !subject.trim();

  const handleSubmit = async () => {
    if (pendingRef.current || disabled || !content.trim() || emailMissingSubject) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const completed = await onSend(content, channel, channel === "EMAIL" ? subject.trim() : undefined);
      if (completed) {
        setContent("");
        setSubject("");
      }
    } catch {
      // The parent reports delivery errors. Keep the draft if a callback rejects.
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2">
        <Tabs value={channel} onValueChange={(v) => setChannel(v as "SMS" | "EMAIL" | "NOTE")}>
          <TabsList className="h-8">
            <TabsTrigger value="SMS" className="text-xs gap-1 h-6" disabled={smsOptedOut || busy}>
              <MessageSquare className="h-3 w-3" /> SMS
            </TabsTrigger>
            <TabsTrigger value="EMAIL" disabled={busy} className="text-xs gap-1 h-6">
              <Mail className="h-3 w-3" /> Email
            </TabsTrigger>
            <TabsTrigger value="NOTE" disabled={busy} className="text-xs gap-1 h-6">
              <StickyNote className="h-3 w-3" /> Note
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {channel === "EMAIL" && (
        <Input
          disabled={busy}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="h-8 bg-background/60 text-[13px]"
        />
      )}
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          disabled={busy}
          value={content}
          onChange={(e) => { setContent(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
          placeholder={channel === "NOTE" ? "Write an internal note..." : `Send ${channel}...`}
          className="min-h-[44px] max-h-[120px] bg-background/60 text-[14px] flex-1 resize-none overflow-y-auto"
          rows={1}
        />
        <div className="flex flex-col gap-1 shrink-0">
          <Button size="icon" onClick={handleSubmit} disabled={!content.trim() || emailMissingSubject || busy} className="h-[44px] w-[44px]" aria-label={pending ? "Sending message" : "Send message"} aria-busy={pending}>
            <Send className="h-4 w-4" />
          </Button>
          {channel !== "NOTE" && !busy && <TemplateSelector onSelect={(text) => { if (!pendingRef.current) setContent(text); }} />}
        </div>
      </div>
      {channel === "SMS" && content.length > 0 && (
        <p className={cn("text-xs text-right", content.length > SMS_SEGMENT_LENGTH ? "text-amber-600" : "text-muted-foreground")}>
          {content.length}/{SMS_SEGMENT_LENGTH} chars{smsSegments > 1 && ` · ${smsSegments} segments`}
        </p>
      )}
    </div>
  );
}
