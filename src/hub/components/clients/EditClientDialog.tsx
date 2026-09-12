import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/hub/contexts/AuthContext";
import type { ClientWithPets } from "@/hub/hooks/use-clients";
import { ClientFormFields } from "./ClientFormFields";
import { normalizeClientForm, type ClientFormValues } from "./client-form";
import { supabase } from "@/integrations/supabase/client";

interface EditClientDialogProps { client: ClientWithPets; }

function valuesFromClient(client: ClientWithPets): ClientFormValues {
  return {
    first_name: client.first_name, last_name: client.last_name,
    primary_phone: client.primary_phone ?? "", primary_email: client.primary_email ?? "",
    preferred_channel: client.preferred_channel === "EMAIL" || client.preferred_channel === "VOICE" ? client.preferred_channel : "SMS",
    mailing_address: client.mailing_address ?? "", housecall_address: client.housecall_address ?? "",
  };
}

export function EditClientDialog({ client }: EditClientDialogProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => valuesFromClient(client));
  const [expectedVersion, setExpectedVersion] = useState(client.version);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const pending = useRef(false);

  const changeOpen = (next: boolean) => {
    if (pending.current) return;
    if (next) { setValues(valuesFromClient(client)); setExpectedVersion(client.version); setErrorMessage(null); setConflict(false); }
    setOpen(next);
  };
  const reloadSaved = async () => {
    if (pending.current) return;
    pending.current = true; setSaving(true);
    try {
      const { data, error } = await supabase.from("clients").select("*").eq("id", client.id).single();
      if (error) throw error;
      setValues(valuesFromClient({ ...client, ...data })); setExpectedVersion(data.version);
      setErrorMessage(null); setConflict(false);
    } catch { setErrorMessage("Unable to reload saved details. Your changes are still here."); }
    finally { pending.current = false; setSaving(false); }
  };
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true); setErrorMessage(null);
    try {
      if (!session) throw new Error("Sign in again before saving a client.");
      const normalized = normalizeClientForm(values);
      const { error } = await supabase.rpc("save_client", {
        p_actor_id: session.user.id, p_client_id: client.id, p_expected_version: expectedVersion,
        p_first_name: normalized.first_name, p_last_name: normalized.last_name,
        p_primary_phone: normalized.primary_phone, p_primary_email: normalized.primary_email,
        p_preferred_channel: normalized.preferred_channel, p_mailing_address: normalized.mailing_address,
        p_housecall_address: normalized.housecall_address,
      });
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client", client.id] }),
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
      ]);
      toast.success("Client details updated"); setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Unable to save client details. Your changes are still here.";
      setErrorMessage(message);
      setConflict((error as { code?: string })?.code === "40001");
    } finally { pending.current = false; setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm">Edit client</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Edit client</DialogTitle><DialogDescription>Update contact details and the separate mailing and housecall locations.</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={saving} className="space-y-4">
          <ClientFormFields values={values} onChange={setValues} idPrefix="edit-client" />
          {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
          {conflict && <Button type="button" variant="outline" onClick={() => void reloadSaved()}>Reload saved details (replace this draft)</Button>}
          <Button type="submit" className="w-full">{saving ? "Saving…" : "Save client"}</Button>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>;
}
