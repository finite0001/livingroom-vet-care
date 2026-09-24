import { useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Mail, Phone, RefreshCw, Send, TimerReset, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import {
  OUTBOUND_DELIVERY_STATUSES,
  deliveryPayloadText,
  isOutboundDeliveryCancelable,
  isOutboundDeliveryRetryable,
  outboundDeliveryStatusLabel,
  useCancelOutboundDelivery,
  useOutboundDeliveries,
  useRetryOutboundDelivery,
  type OutboundDeliveryStatus,
  type OutboundDeliveryWithDetails,
} from "@/hub/hooks/use-outbound-deliveries";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

const FILTERS: (OutboundDeliveryStatus | "ALL")[] = ["ALL", ...OUTBOUND_DELIVERY_STATUSES];

const STATUS_TONE: Record<OutboundDeliveryStatus, string> = {
  QUEUED: "bg-primary/10 text-primary",
  LEASED: "bg-accent text-accent-foreground",
  ACCEPTED: "bg-primary/10 text-primary",
  DELIVERED: "bg-primary/10 text-primary",
  FAILED: "bg-destructive/10 text-destructive",
  CANCELED: "bg-muted text-muted-foreground",
  UNKNOWN: "bg-destructive/10 text-destructive",
};

const STATUS_ICON: Record<OutboundDeliveryStatus, typeof Clock3> = {
  QUEUED: Clock3,
  LEASED: TimerReset,
  ACCEPTED: CheckCircle2,
  DELIVERED: CheckCircle2,
  FAILED: AlertTriangle,
  CANCELED: AlertTriangle,
  UNKNOWN: AlertTriangle,
};

function formatRelative(value: string | null) {
  return value ? formatDistanceToNow(parseISO(value), { addSuffix: true }) : "Not set";
}

function deliveryTimestamp(delivery: OutboundDeliveryWithDetails): string {
  return delivery.delivered_at ?? delivery.accepted_at ?? delivery.failed_at ?? delivery.unknown_at ?? delivery.canceled_at ?? delivery.leased_at ?? delivery.created_at;
}

interface DeliveryCardProps {
  delivery: OutboundDeliveryWithDetails;
}

function DeliveryCard({ delivery }: DeliveryCardProps) {
  const retryDelivery = useRetryOutboundDelivery();
  const cancelDelivery = useCancelOutboundDelivery();
  const StatusIcon = STATUS_ICON[delivery.status];
  const payloadText = deliveryPayloadText(delivery.payload);
  const attempts = `${delivery.attempt_count}/${delivery.max_attempts}`;
  const channelIcon = delivery.channel === "SMS" ? Phone : Mail;
  const ChannelIcon = channelIcon;
  const retryable = isOutboundDeliveryRetryable(delivery.status);
  const cancelable = isOutboundDeliveryCancelable(delivery.status);
  const actionBusy = retryDelivery.isPending || cancelDelivery.isPending;

  const handleRetry = () => {
    retryDelivery.mutate({ id: delivery.id, updated_at: delivery.updated_at }, {
      onSuccess: () => toast.success("Delivery requeued"),
      onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to retry delivery. Refresh and try again."),
    });
  };

  const handleCancel = () => {
    if (!window.confirm("Cancel this queued delivery? The staff message will remain visible, but this delivery attempt will not be sent.")) return;
    cancelDelivery.mutate({ id: delivery.id, updated_at: delivery.updated_at }, {
      onSuccess: () => toast.success("Delivery canceled"),
      onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to cancel delivery. Refresh and try again."),
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("gap-1 border-transparent text-xs", STATUS_TONE[delivery.status])}>
                <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {outboundDeliveryStatusLabel(delivery.status)}
              </Badge>
              <Badge variant="outline" className="gap-1 text-xs">
                <ChannelIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {delivery.channel}
              </Badge>
              <span className="text-xs text-muted-foreground">Attempts {attempts}</span>
            </div>
            <p className="truncate text-sm font-semibold">
              {delivery.client?.full_name ?? "Unlinked client"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{delivery.recipient}</p>
          </div>

          <div className="text-left text-xs text-muted-foreground md:text-right">
            <p>Created {formatRelative(delivery.created_at)}</p>
            <p>Next attempt {formatRelative(delivery.next_attempt_at)}</p>
          </div>
        </div>

        <div className="rounded-lg bg-muted/50 p-3">
          <p className="line-clamp-2 text-sm text-foreground">
            {delivery.message?.content ?? payloadText ?? "No message preview available"}
          </p>
          {delivery.status_note && (
            <p className="mt-2 text-xs text-muted-foreground">{delivery.status_note}</p>
          )}
          {delivery.last_error_text && (
            <p className="mt-2 text-xs text-destructive">{delivery.last_error_text}</p>
          )}
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <span>Last status {formatRelative(deliveryTimestamp(delivery))}</span>
          <span>Provider {delivery.provider ?? "Pending"}</span>
          <span className="truncate">Provider ID {delivery.provider_message_id ?? "Pending"}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {retryable && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleRetry} disabled={actionBusy}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          )}
          {cancelable && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-destructive/30 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleCancel}
              disabled={actionBusy}
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
          )}
          {delivery.conversation_id && (
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Link to={`/hub/conversation/${delivery.conversation_id}`}>
                Conversation
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          )}
          {delivery.client_id && (
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Link to={`/hub/client/${delivery.client_id}`}>
                Client
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface SummaryStatProps {
  label: string;
  value: number;
}

function SummaryStat({ label, value }: SummaryStatProps) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

export default function DeliveriesPage() {
  usePageTitle("Outbound Deliveries");
  const [filter, setFilter] = useState<OutboundDeliveryStatus | "ALL">("ALL");
  const { data: deliveries, error, isError, isFetching, isLoading, refetch } = useOutboundDeliveries(filter);

  const summary = useMemo(() => {
    const rows = deliveries ?? [];
    return {
      total: rows.length,
      pending: rows.filter((delivery) => delivery.status === "QUEUED" || delivery.status === "LEASED").length,
      failed: rows.filter((delivery) => delivery.status === "FAILED" || delivery.status === "UNKNOWN").length,
      delivered: rows.filter((delivery) => delivery.status === "DELIVERED").length,
    };
  }, [deliveries]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="flex h-14 items-center justify-between px-4">
          <div>
            <h1 className="text-lg font-semibold">Outbound Deliveries</h1>
            <p className="text-xs text-muted-foreground">Queued sends, provider results, and delivery exceptions</p>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">
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
              {status === "ALL" ? "All" : outboundDeliveryStatusLabel(status)}
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 border-b bg-muted/30 p-3 md:grid-cols-4" aria-label="Delivery summary">
        <SummaryStat label="Showing" value={summary.total} />
        <SummaryStat label="Pending" value={summary.pending} />
        <SummaryStat label="Needs review" value={summary.failed} />
        <SummaryStat label="Delivered" value={summary.delivered} />
      </section>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-3 p-4">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, index) => (
              <Skeleton key={index} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Could not load outbound deliveries</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "Check your connection and try again."}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()} disabled={isFetching}>
              Retry
            </Button>
          </div>
        ) : !deliveries || deliveries.length === 0 ? (
          <EmptyState
            icon={Send}
            title={filter === "ALL" ? "No outbound deliveries yet" : `No ${outboundDeliveryStatusLabel(filter).toLowerCase()} deliveries`}
            description="Staff sends and reminder jobs will appear here once queued."
          />
        ) : (
          deliveries.map((delivery) => <DeliveryCard key={delivery.id} delivery={delivery} />)
        )}
      </main>
    </div>
  );
}
