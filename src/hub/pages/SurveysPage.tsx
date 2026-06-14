import { useState } from "react";
import { BarChart3, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useSurveys, useSurveyStats, useCreateSurvey, useUpdateSurvey, useDeleteSurvey,
  SURVEY_TYPES, surveyTypeLabel, type SurveyType,
} from "@/hub/hooks/use-surveys";

export default function SurveysPage() {
  usePageTitle("Surveys");
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const { data: surveys, isLoading } = useSurveys();
  const { data: stats } = useSurveyStats();
  const create = useCreateSurvey();
  const update = useUpdateSurvey();
  const del = useDeleteSurvey();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<SurveyType>("NPS");
  const [question, setQuestion] = useState("How likely are you to recommend us? Reply 0-10.");
  const [onClose, setOnClose] = useState(true);
  const [delay, setDelay] = useState("2");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const reset = () => { setName(""); setType("NPS"); setQuestion("How likely are you to recommend us? Reply 0-10."); setOnClose(true); setDelay("2"); };

  const handleCreate = () => {
    if (!name.trim() || !question.trim()) { toast.error("Name and question are required"); return; }
    create.mutate(
      { name: name.trim(), survey_type: type, question: question.trim(), trigger_on_ticket_close: onClose, delay_hours: Number(delay) || 0 },
      { onSuccess: () => { toast.success("Survey created"); setOpen(false); reset(); }, onError: () => toast.error("Failed to create survey") },
    );
  };

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Surveys</h1>
        <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => { reset(); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> New</Button>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
        {isLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
        ) : !surveys || surveys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No surveys yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create a survey to collect client feedback.</p>
          </div>
        ) : (
          surveys.map((s) => {
            const stat = stats?.[s.id];
            return (
              <Card key={s.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        <Badge variant="outline" className="h-5 text-[10px]">{surveyTypeLabel(s.survey_type)}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.question}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Switch checked={s.is_active} onCheckedChange={(c) => update.mutate({ id: s.id, is_active: c }, { onError: () => toast.error("Failed to update") })} aria-label="Active" />
                      {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Delete survey" onClick={() => setPendingDelete({ id: s.id, name: s.name })}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 border-t pt-2 text-xs text-muted-foreground">
                    <span>{s.trigger_on_ticket_close ? `Sends ${s.delay_hours}h after ticket close` : "Manual trigger"}</span>
                    <span className="tabular-nums">{stat?.responses ?? 0} responses{stat?.avgScore != null ? ` · avg ${stat.avgScore}` : ""}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader><SheetTitle>New survey</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5"><Label className="text-sm">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post-visit NPS" /></div>
            <div className="space-y-1.5">
              <Label className="text-sm">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as SurveyType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SURVEY_TYPES.map((t) => <SelectItem key={t} value={t}>{surveyTypeLabel(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-sm">Question</Label><Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} /></div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Send after a ticket closes</Label>
              <Switch checked={onClose} onCheckedChange={setOnClose} aria-label="Trigger on ticket close" />
            </div>
            {onClose && (
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm text-muted-foreground">Delay</Label>
                <div className="flex items-center gap-1.5"><Input type="number" min={0} value={delay} onChange={(e) => setDelay(e.target.value)} className="h-8 w-20 text-right text-sm" /><span className="text-xs text-muted-foreground">hours</span></div>
              </div>
            )}
            <Button className="w-full" onClick={handleCreate} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create survey"}</Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete survey?</AlertDialogTitle><AlertDialogDescription>This deletes "{pendingDelete?.name}" and its responses. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (pendingDelete) { del.mutate(pendingDelete.id, { onSuccess: () => toast.success("Survey deleted"), onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete") }); setPendingDelete(null); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
