import { useState } from "react";
import { Pill, Plus, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { useProfiles } from "@/hub/hooks/use-profiles";
import { useClients, type ClientWithPets } from "@/hub/hooks/use-clients";
import {
  useRefills, useCreateRefill, useUpdateRefill, REFILL_STATUSES, refillStatusLabel,
  type RefillStatus,
} from "@/hub/hooks/use-refills";

const STATUS_TONE: Record<string, string> = {
  REQUESTED: "bg-blue-500/10 text-blue-600",
  APPROVED: "bg-amber-500/10 text-amber-600",
  READY: "bg-green-500/10 text-green-600",
  PICKED_UP: "bg-muted text-muted-foreground",
  DENIED: "bg-destructive/10 text-destructive",
};
const UNASSIGNED = "__unassigned__";
const FILTERS: (RefillStatus | "ALL")[] = ["ALL", ...REFILL_STATUSES];

export default function RefillsPage() {
  usePageTitle("Refills");
  const [filter, setFilter] = useState<RefillStatus | "ALL">("ALL");
  const { data: refills, isLoading } = useRefills(filter);
  const { data: staff } = useProfiles();
  const update = useUpdateRefill();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Refills</h1>
        <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New</Button>
      </header>

      <div className="border-b bg-card px-3 py-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors", filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent")}>
              {f === "ALL" ? "All" : refillStatusLabel(f)}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-2 p-4">
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
        ) : !refills || refills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Pill className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No refill requests{filter !== "ALL" ? ` (${refillStatusLabel(filter)})` : ""}</p>
            <p className="mt-1 text-xs text-muted-foreground">New refill requests will appear here.</p>
          </div>
        ) : (
          refills.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.medication_name || "Refill request"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.client_name ?? "Unknown client"}{r.pet_name ? ` · ${r.pet_name}` : ""} · {formatDistanceToNow(new Date(r.requested_at), { addSuffix: true })}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_TONE[r.status])}>{refillStatusLabel(r.status)}</span>
                </div>
                <div className="flex gap-2">
                  <Select value={r.status} onValueChange={(v) => update.mutate({ id: r.id, status: v as RefillStatus }, { onError: () => toast.error("Failed to update status") })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{REFILL_STATUSES.map((s) => <SelectItem key={s} value={s}>{refillStatusLabel(s)}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={r.assigned_to_id ?? UNASSIGNED} onValueChange={(v) => update.mutate({ id: r.id, assigned_to_id: v === UNASSIGNED ? null : v }, { onError: () => toast.error("Failed to assign") })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Assign" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {(staff ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <NewRefillSheet open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewRefillSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: clients } = useClients();
  const create = useCreateRefill();
  const [search, setSearch] = useState("");
  const [client, setClient] = useState<ClientWithPets | null>(null);
  const [petId, setPetId] = useState<string>("");
  const [medication, setMedication] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => { setSearch(""); setClient(null); setPetId(""); setMedication(""); setNotes(""); };
  const close = (o: boolean) => { onOpenChange(o); if (!o) reset(); };

  const q = search.trim().toLowerCase();
  const matches = (clients ?? []).filter((c) => !q || c.full_name.toLowerCase().includes(q)).slice(0, 8);

  const handleCreate = () => {
    if (!client || !medication.trim()) { toast.error("Pick a client and enter a medication"); return; }
    create.mutate(
      { client_id: client.id, pet_id: petId || null, medication_name: medication.trim(), notes: notes.trim() || null },
      { onSuccess: () => { toast.success("Refill request created"); close(false); }, onError: () => toast.error("Failed to create refill") },
    );
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader><SheetTitle>New refill request</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          {!client ? (
            <div className="space-y-2">
              <Label className="text-sm">Client</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" className="pl-9" autoFocus />
              </div>
              <div className="max-h-60 space-y-1 overflow-y-auto">
                {matches.map((c) => (
                  <button key={c.id} onClick={() => { setClient(c); setPetId(c.pets[0]?.id ?? ""); }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-accent">
                    <span className="font-medium">{c.full_name}</span>
                    <span className="text-xs text-muted-foreground">{c.pets.map((p) => p.name).join(", ")}</span>
                  </button>
                ))}
                {q && matches.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No clients found.</p>}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{client.full_name}</p>
                  <p className="text-xs text-muted-foreground">{client.pets.length} pet{client.pets.length === 1 ? "" : "s"}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setClient(null); setPetId(""); }}>Change</Button>
              </div>
              {client.pets.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-sm">Pet</Label>
                  <Select value={petId} onValueChange={setPetId}>
                    <SelectTrigger><SelectValue placeholder="Select pet (optional)" /></SelectTrigger>
                    <SelectContent>{client.pets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5"><Label className="text-sm">Medication *</Label><Input value={medication} onChange={(e) => setMedication(e.target.value)} placeholder="e.g. Apoquel 16mg" /></div>
              <div className="space-y-1.5"><Label className="text-sm">Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></div>
              <Button className="w-full" onClick={handleCreate} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create refill request"}</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
