import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, Mail, Phone, UserRound } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import {
  CONTACT_SUBMISSION_STATUSES,
  contactSubmissionStatusLabel,
  useContactSubmissions,
  useUpdateContactSubmissionTriage,
  type ContactSubmission,
  type ContactSubmissionStatus,
} from "@/hub/hooks/use-contact-submissions";

const FILTERS: (ContactSubmissionStatus | "ALL")[] = ["ALL", ...CONTACT_SUBMISSION_STATUSES];

const STATUS_TONE: Record<ContactSubmissionStatus, string> = {
  NEW: "bg-blue-500/10 text-blue-600",
  CONTACTED: "bg-amber-500/10 text-amber-600",
  CLOSED: "bg-muted text-muted-foreground",
};

interface ContactSubmissionCardProps {
  submission: ContactSubmission;
}

function formatOptionalDate(value: string | null) {
  return value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : "Not yet";
}

function ContactSubmissionCard({ submission }: ContactSubmissionCardProps) {
  const update = useUpdateContactSubmissionTriage();
  const [staffNotes, setStaffNotes] = useState(submission.staff_notes ?? "");
  const emailHref = `mailto:${submission.email}?subject=${encodeURIComponent(`Re: ${submission.subject}`)}`;
  const phoneHref = submission.phone ? `tel:${submission.phone.replace(/[^\d+]/g, "")}` : null;
  const savedNotes = submission.staff_notes ?? "";
  const notesChanged = staffNotes.trim() !== savedNotes;
  const busy = update.isPending;

  useEffect(() => {
    setStaffNotes(submission.staff_notes ?? "");
  }, [submission.id, submission.staff_notes]);

  const handleStatusChange = (triage_status: ContactSubmissionStatus) => {
    update.mutate(
      { id: submission.id, triage_status },
      {
        onSuccess: () => toast.success("Contact submission updated"),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update submission"),
      },
    );
  };

  const handleSaveNotes = () => {
    update.mutate(
      { id: submission.id, staff_notes: staffNotes.trim() || null },
      {
        onSuccess: () => toast.success("Staff notes saved"),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save notes"),
      },
    );
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-semibold">{submission.name}</p>
              <Badge className={cn("shrink-0 border-transparent text-[10px]", STATUS_TONE[submission.triage_status])}>
                {contactSubmissionStatusLabel(submission.triage_status)}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(submission.created_at), { addSuffix: true })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <a href={emailHref}>
                <Mail className="h-3.5 w-3.5" />
                Email
              </a>
            </Button>
            {phoneHref && (
              <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <a href={phoneHref}>
                  <Phone className="h-3.5 w-3.5" />
                  Call
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor={`contact-status-${submission.id}`} className="text-xs">
              Status
            </Label>
            <Select value={submission.triage_status} onValueChange={(value) => handleStatusChange(value as ContactSubmissionStatus)}>
              <SelectTrigger id={`contact-status-${submission.id}`} className="h-8 text-xs" disabled={busy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_SUBMISSION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {contactSubmissionStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground md:grid-cols-3">
            <span className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              Reviewed: {formatOptionalDate(submission.reviewed_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              Contacted: {formatOptionalDate(submission.contacted_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Closed: {formatOptionalDate(submission.closed_at)}
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">{submission.subject}</p>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{submission.message}</p>
        </div>

        <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground md:grid-cols-2">
          <a className="flex items-center gap-1.5 truncate hover:text-foreground" href={emailHref}>
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{submission.email}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          {submission.phone ? (
            <a className="flex items-center gap-1.5 truncate hover:text-foreground" href={phoneHref ?? undefined}>
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{submission.phone}</span>
            </a>
          ) : (
            <span>No phone provided</span>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`contact-notes-${submission.id}`} className="text-xs">
            Staff notes
          </Label>
          <Textarea
            id={`contact-notes-${submission.id}`}
            value={staffNotes}
            onChange={(event) => setStaffNotes(event.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="Internal triage notes..."
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" onClick={handleSaveNotes} disabled={busy || !notesChanged}>
              Save notes
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ContactSubmissionsPage() {
  usePageTitle("Contact Submissions");
  const [filter, setFilter] = useState<ContactSubmissionStatus | "ALL">("ALL");
  const { data: submissions, error, isError, isFetching, isLoading, refetch } = useContactSubmissions(filter);

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Contact Submissions</h1>
      </header>

      <div className="border-b bg-card px-3 py-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              aria-pressed={filter === status}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === status ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {status === "ALL" ? "All" : contactSubmissionStatusLabel(status)}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-3 p-4">
        {isLoading ? (
          <div className="space-y-3">{[...Array(4)].map((_, index) => <Skeleton key={index} className="h-36 w-full rounded-lg" />)}</div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Mail className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">Could not load contact submissions</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "Check your connection and try again."}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()} disabled={isFetching}>
              Retry
            </Button>
          </div>
        ) : (submissions ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Mail className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No contact submissions{filter !== "ALL" ? ` (${contactSubmissionStatusLabel(filter)})` : ""}</p>
            <p className="mt-1 text-xs text-muted-foreground">Public website messages will land here.</p>
          </div>
        ) : (
          (submissions ?? []).map((submission) => <ContactSubmissionCard key={submission.id} submission={submission} />)
        )}
      </div>
    </div>
  );
}
