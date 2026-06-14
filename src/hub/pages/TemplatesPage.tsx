import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useTemplates, useCreateTemplate, useUpdateTemplate, useDeleteTemplate,
  type MessageTemplate,
} from "@/hub/hooks/use-templates";

const CATEGORIES = ["General", "Appointment", "Refill", "Follow-Up", "Billing", "Emergency"];
const CHANNELS = ["SMS", "EMAIL"];

interface FormState { title: string; content: string; category: string; channel: string; }
const EMPTY: FormState = { title: "", content: "", category: "General", channel: "SMS" };

export default function TemplatesPage() {
  usePageTitle("Message Templates");
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const { data: templates, isLoading } = useTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  // Sync the form whenever the sheet opens for create (editing=null) or edit.
  useEffect(() => {
    if (!sheetOpen) return;
    setForm(editing ? { title: editing.title, content: editing.content, category: editing.category, channel: editing.channel } : EMPTY);
  }, [sheetOpen, editing]);

  const openCreate = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (t: MessageTemplate) => { setEditing(t); setSheetOpen(true); };

  const saving = createTemplate.isPending || updateTemplate.isPending;
  const handleSave = () => {
    if (!form.title.trim() || !form.content.trim()) { toast.error("Title and content are required"); return; }
    const payload = { title: form.title.trim(), content: form.content.trim(), category: form.category, channel: form.channel };
    const opts = {
      onSuccess: () => { toast.success(editing ? "Template updated" : "Template created"); setSheetOpen(false); setEditing(null); },
      onError: () => toast.error(editing ? "Failed to update template" : "Failed to create template"),
    };
    if (editing) updateTemplate.mutate({ id: editing.id, ...payload }, opts);
    else createTemplate.mutate(payload, opts);
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteTemplate.mutate(pendingDelete.id, {
      onSuccess: () => { toast.success("Template deleted"); setPendingDelete(null); },
      onError: () => toast.error("Failed to delete template"),
    });
  };

  const q = search.trim().toLowerCase();
  const filtered = (templates ?? []).filter((t) =>
    !q || t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  const grouped = filtered.reduce<Record<string, MessageTemplate[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Message Templates</h1>
        <Button size="sm" className="h-8 gap-1 text-xs" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> New</Button>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…" className="pl-9" />
        </div>

        {isLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">{q ? "No matching templates" : "No templates yet"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{q ? "Try a different search." : "Create your first template to speed up replies."}</p>
          </div>
        ) : (
          Object.entries(grouped).map(([cat, items]) => (
            <Card key={cat}>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {items.map((t) => (
                  <div key={t.id} className="group/row flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <Badge variant="outline" className="h-5 text-[10px]">{t.channel}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{t.content}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Edit template" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Delete template" onClick={() => setPendingDelete({ id: t.id, name: t.title })}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) setEditing(null); }}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{editing ? "Edit template" : "New template"}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Appointment confirmation" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Content</Label>
              <Textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder="Hi {{client_name}}, this is a reminder…" rows={6} />
              <p className="text-xs text-muted-foreground">Use {"{{client_name}}"}, {"{{pet_name}}"}, {"{{date}}"} as placeholders.</p>
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create template"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete "{pendingDelete?.name}". This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
