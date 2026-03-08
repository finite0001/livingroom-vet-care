import { useState } from "react";
import { Eye, EyeOff, Archive, ArchiveRestore, Trash2, UserCheck } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AssignmentDropdown } from "./AssignmentDropdown";
import type { ConversationWithClient } from "@/hub/hooks/use-conversations";

interface ConversationActionSheetProps {
  conversation: ConversationWithClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleRead: (convId: string, currentIsRead: boolean) => void;
  onArchive: (convId: string) => void;
  onDelete: (convId: string) => void;
  onAssign: (convId: string, dvmId: string | null) => void;
  isArchiveView?: boolean;
}

export function ConversationActionSheet({ conversation, open, onOpenChange, onToggleRead, onArchive, onDelete, onAssign, isArchiveView }: ConversationActionSheetProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  if (!conversation) return null;
  const isUnread = !conversation.is_read;
  const clientName = `${conversation.client.first_name} ${conversation.client.last_name}`;

  const actions = [
    { icon: isUnread ? Eye : EyeOff, label: isUnread ? "Mark as read" : "Mark as unread", onClick: () => { onToggleRead(conversation.id, conversation.is_read); onOpenChange(false); } },
    { icon: isArchiveView ? ArchiveRestore : Archive, label: isArchiveView ? "Unarchive" : "Archive", onClick: () => { onArchive(conversation.id); onOpenChange(false); } },
    { icon: Trash2, label: "Delete conversation", destructive: true, onClick: () => setDeleteDialogOpen(true) },
  ];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="pb-8">
          <SheetHeader><SheetTitle className="text-sm">{clientName}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-1">
            {actions.map((action) => (
              <button key={action.label} onClick={action.onClick} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-accent ${action.destructive ? "text-destructive" : "text-foreground"}`}>
                <action.icon className="h-5 w-5" /> {action.label}
              </button>
            ))}
            <div className="flex items-center gap-3 px-3 py-2">
              <UserCheck className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground mr-auto">Assign</span>
              <AssignmentDropdown currentAssigneeId={conversation.assigned_to_id} onAssign={(dvmId) => { onAssign(conversation.id, dvmId); onOpenChange(false); }} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete conversation?</AlertDialogTitle><AlertDialogDescription>This will permanently delete this conversation and all its messages.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { onDelete(conversation.id); setDeleteDialogOpen(false); onOpenChange(false); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
