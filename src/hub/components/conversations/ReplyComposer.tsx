import { addConversationAttachments, type SelectedConversationAttachment } from "@/hub/features/communications/attachment-selection";
import { MessageRecoveryPanel } from "./MessageRecoveryPanel";
import type { MessageIntent } from "@/hub/features/communications/queue-intent";
import type { useMessageQueue } from "@/hub/hooks/use-message-queue";
import { useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MessageSquare, StickyNote, Mail, Paperclip, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateSelector } from "./TemplateSelector";
import { cn } from "@/lib/utils";

interface ReplyComposerProps {
  onSend: (
    content: string,
    channel: "SMS" | "EMAIL" | "NOTE",
    subject?: string,
    restored?: MessageIntent,
    attachments?: SelectedConversationAttachment[],
  ) => Promise<boolean>;
  defaultChannel?: "SMS" | "EMAIL" | "NOTE";
  smsOptedOut?: boolean;
  draft?: string;
  onDraftConsumed?: () => void;
  disabled?: boolean;
  queue: ReturnType<typeof useMessageQueue>;
  conversationId: string;
  recipients: { EMAIL: string | null; SMS: string | null };
}

const SMS_SEGMENT_LENGTH = 160;

export function ReplyComposer({
  onSend,
  defaultChannel,
  smsOptedOut,
  draft,
  onDraftConsumed,
  disabled,
  queue,
  conversationId,
  recipients,
}: ReplyComposerProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<SelectedConversationAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [restored, setRestored] = useState<MessageIntent | undefined>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = pending || disabled || queue.pending;
  const recoveryBlocksSend =
    !!queue.recovery &&
    (queue.recovery.status !== "prepared" ||
      !restored ||
      restored.body !== content);
  // Only populate from a suggestion/draft when the composer is empty, so tapping a
  // smart-reply can never silently overwrite a reply the staffer is mid-typing.
  useEffect(() => {
    if (!draft || pendingRef.current) return;
    if (!content.trim()) setContent(draft);
    // Consume rejected suggestions too, so clearing a typed reply cannot revive one.
    onDraftConsumed?.();
  }, [draft, content, onDraftConsumed, pending]);

  const [channel, setChannel] = useState<"SMS" | "EMAIL" | "NOTE">(
    defaultChannel || "SMS",
  );
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

  useEffect(() => {
    autoResize();
  }, [channel, content, autoResize]);

  const smsSegments =
    channel === "SMS" ? Math.ceil(content.length / SMS_SEGMENT_LENGTH) : 0;

  const emailMissingSubject = channel === "EMAIL" && !subject.trim();

  const handleSubmit = async () => {
    if (
      pendingRef.current ||
      disabled ||
      recoveryBlocksSend ||
      !content.trim() ||
      emailMissingSubject
    )
      return;
    pendingRef.current = true;
    setPending(true);
    try {
      const completed = await onSend(
        content,
        channel,
        channel === "EMAIL" ? subject : undefined,
        restored,
        channel === "EMAIL" ? attachments : [],
      );
      if (completed) {
        if (channel === "EMAIL") setAttachments([]);
        setContent("");
        setSubject("");
        setRestored(undefined);
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
      <MessageRecoveryPanel
        queue={queue}
        hasDraft={!!content || !!subject || attachments.length > 0}
        onRestore={(saved) => {
          if (saved.conversation_id !== conversationId)
            throw new Error(
              "This saved draft belongs to another conversation.",
            );
          setContent(saved.body);
          setSubject(saved.subject);
          setChannel(saved.channel);
          setRestored(saved);
          setAttachments([]);
          setAttachmentError(null);
        }}
        onAcknowledged={(saved) => {
          if (
            saved &&
            saved.body === content &&
            saved.subject === (channel === "EMAIL" ? subject : "") &&
            saved.channel === channel &&
            saved.to ===
              (restored && queue.recovery ? restored.to : recipients[channel])
          ) {
            setContent("");
            setSubject("");
            setRestored(undefined);
            if (saved.channel === "EMAIL") setAttachments([]);
          }
        }}
      />
      {restored && queue.recovery && (
        <p className="text-xs text-muted-foreground">
          Saved recipient: {restored.to}. Retry keeps this exact recipient.
        </p>
      )}
      {!restored && channel !== "NOTE" && (
        <p className="text-xs text-muted-foreground break-all">
          Recipient: {recipients[channel] ?? "No current recipient"}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Tabs
          value={channel}
          onValueChange={(v) => {
            setChannel(v as "SMS" | "EMAIL" | "NOTE");
            setRestored(undefined);
          }}
        >
          <TabsList className="h-8">
            <TabsTrigger
              value="SMS"
              className="text-xs gap-1 h-6"
              disabled={smsOptedOut || busy}
            >
              <MessageSquare className="h-3 w-3" /> SMS
            </TabsTrigger>
            <TabsTrigger
              value="EMAIL"
              disabled={busy}
              className="text-xs gap-1 h-6"
            >
              <Mail className="h-3 w-3" /> Email
            </TabsTrigger>
            <TabsTrigger
              value="NOTE"
              disabled={busy}
              className="text-xs gap-1 h-6"
            >
              <StickyNote className="h-3 w-3" /> Note
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {channel === "EMAIL" && (
        <Input
          disabled={busy}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setRestored(undefined);
          }}
          placeholder="Subject"
          className="h-8 bg-background/60 text-[13px]"
        />
      )}
      {channel === "EMAIL" && (
        <div className="space-y-2">
          <input ref={fileInput} type="file" multiple accept="application/pdf,image/png,image/jpeg" className="sr-only" aria-label="Choose email attachments" disabled={busy || !!queue.recovery} onChange={event => {
            try {
              setAttachments(addConversationAttachments(attachments, Array.from(event.target.files ?? [])));
              setAttachmentError(null);
            } catch (error) { setAttachmentError(error instanceof Error ? error.message : "Unable to select files."); }
            event.target.value = "";
          }} />
          <Button type="button" variant="ghost" size="sm" disabled={busy || !!queue.recovery || attachments.length >= 5} onClick={() => fileInput.current?.click()}>
            <Paperclip className="mr-1 h-4 w-4" aria-hidden="true" /> Attach files
          </Button>
          {attachments.length > 0 && <ul aria-label="Selected attachments" className="space-y-1">
            {attachments.map(item => <li key={item.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{item.file.name}</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${item.file.name}`} disabled={busy || !!queue.recovery} onClick={() => setAttachments(current => current.filter(file => file.id !== item.id))}><X className="h-3 w-3" aria-hidden="true" /></Button>
            </li>)}
          </ul>}
          {restored?.attachment_ids.length ? <p className="text-xs text-muted-foreground">{restored.attachment_ids.length} saved attachment(s). Sending opens a review first.</p> : null}
          {attachmentError && <p role="alert" className="text-sm text-destructive">{attachmentError}</p>}
          {attachments.length > 0 && <p className="text-xs text-muted-foreground">You’ll review the email and files before queueing.</p>}
        </div>
      )}
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          disabled={busy}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setRestored(undefined);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            channel === "NOTE"
              ? "Write an internal note..."
              : `Send ${channel}...`
          }
          className="min-h-[44px] max-h-[120px] bg-background/60 text-[14px] flex-1 resize-none overflow-y-auto"
          rows={1}
        />
        <div className="flex flex-col gap-1 shrink-0">
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={
              !content.trim() ||
              emailMissingSubject ||
              busy ||
              recoveryBlocksSend
            }
            className="h-[44px] w-[44px]"
            aria-label={pending ? "Sending message" : "Send message"}
            aria-busy={pending}
          >
            <Send className="h-4 w-4" />
          </Button>
          {channel !== "NOTE" && !busy && (
            <TemplateSelector
              onSelect={(text) => {
                if (!pendingRef.current) setContent(text);
              }}
            />
          )}
        </div>
      </div>
      {channel === "SMS" && content.length > 0 && (
        <p
          className={cn(
            "text-xs text-right",
            content.length > SMS_SEGMENT_LENGTH
              ? "text-muted-foreground"
              : "text-muted-foreground",
          )}
        >
          {content.length}/{SMS_SEGMENT_LENGTH} chars
          {smsSegments > 1 && ` · ${smsSegments} segments`}
        </p>
      )}
    </div>
  );
}
