import { useState } from "react";
import { StickyNote, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface ClientNote { id: string; content: string; created_at: string; created_by: string | null; profile?: { full_name: string } | null; }

export function ClientNotesCard({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { data: notes, isLoading } = useQuery({
    queryKey: ["client-notes", clientId],
    queryFn: async (): Promise<ClientNote[]> => {
      const { data, error } = await supabase.from("client_notes").select("id, content, created_at, created_by, profile:profiles(full_name)").eq("client_id", clientId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ClientNote[];
    },
  });

  const addNote = useMutation({
    mutationFn: async (content: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("client_notes").insert({ client_id: clientId, content, created_by: user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["client-notes", clientId] }); setDraft(""); setShowForm(false); toast.success("Note added"); },
    onError: () => toast.error("Failed to add note"),
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("client_notes").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["client-notes", clientId] }); toast.success("Note deleted"); },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><StickyNote className="h-4 w-4" /> Notes</CardTitle>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowForm(!showForm)}><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <div className="space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note about this client..." rows={3} className="text-sm" />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setShowForm(false); setDraft(""); }}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" disabled={!draft.trim() || addNote.isPending} onClick={() => addNote.mutate(draft.trim())}>{addNote.isPending ? "Saving..." : "Save"}</Button>
            </div>
          </div>
        )}
        {isLoading ? <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          : !notes || notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet</p>
          : <div className="space-y-2">{notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-muted/50 p-3 group">
              <p className="text-sm whitespace-pre-wrap">{n.content}</p>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-xs text-muted-foreground">{(n.profile as any)?.full_name ?? "Staff"} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive" onClick={() => setPendingDeleteId(n.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
          ))}</div>}
      </CardContent>
      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete note?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => { if (pendingDeleteId) { deleteNote.mutate(pendingDeleteId); setPendingDeleteId(null); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
