import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hub/contexts/auth-context";
import { ClientFormFields } from "./ClientFormFields";
import { emptyClientForm, normalizeClientForm, isPotentialDuplicate } from "./client-form";

interface DuplicateClient { id: string; full_name: string; }

export function CreateClientSheet() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const queryClient = useQueryClient();
  const [values, setValues] = useState(emptyClientForm);
  const [petName, setPetName] = useState("");
  const [petSpecies, setPetSpecies] = useState("Dog");
  const [duplicates, setDuplicates] = useState<DuplicateClient[]>([]);
  const [reviewedValues, setReviewedValues] = useState<string | null>(null);
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = () => { setValues(emptyClientForm); setPetName(""); setPetSpecies("Dog"); setDuplicates([]); setReviewedValues(null); setCreatedClientId(null); setErrorMessage(null); };
  const handleSubmit = async () => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setErrorMessage(null);
    try {
      if (!session) throw new Error("Sign in again before creating a client.");
      const normalized = normalizeClientForm(values);
      const fullName = `${normalized.first_name} ${normalized.last_name}`;
      let clientId = createdClientId;
      if (!clientId) {
        const fingerprint = JSON.stringify(normalized);
        if (reviewedValues !== fingerprint) {
          const terms = [fullName, normalized.primary_email, normalized.primary_phone].filter((term): term is string => !!term);
          const results = await Promise.all(terms.map(async term => {
            const { data, error } = await supabase.rpc("search_clients", { p_search: term, p_limit: 250 });
            if (error) throw error;
            return data ?? [];
          }));
          const matches = [...new Map(results.flat().filter(client => isPotentialDuplicate(normalized, client)).map(client => [client.id, client])).values()];
          setReviewedValues(fingerprint);
          setDuplicates(matches);
          if (matches.length) return;
        }
        const { data: client, error } = await supabase.rpc("save_client", {
          p_actor_id: session.user.id, p_client_id: null, p_expected_version: null,
          p_first_name: normalized.first_name, p_last_name: normalized.last_name,
          p_primary_phone: normalized.primary_phone, p_primary_email: normalized.primary_email,
          p_preferred_channel: normalized.preferred_channel, p_mailing_address: normalized.mailing_address,
          p_housecall_address: normalized.housecall_address,
        });
        if (error) throw error;
        clientId = client.id; setCreatedClientId(clientId);
        await queryClient.invalidateQueries({ queryKey: ["clients"] });
      }
      if (petName.trim()) {
        const { error } = await supabase.rpc("save_patient", {
          p_id: null, p_expected_version: null,
          p_client_id: clientId, p_name: petName.trim(), p_species: petSpecies,
          p_breed: null, p_dob: null, p_birth_date_precision: "unknown",
          p_color: null, p_sex: "unknown", p_neuter_status: "unknown",
          p_microchip_id: null, p_archived_at: null, p_deceased_at: null,
        });
        if (error) throw new Error("Client saved, but the pet could not be saved. Retry to add the pet, or clear the pet name to finish without it.");
      }
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(`${fullName} added`);
      reset(); setOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : (error as { message?: string })?.message || "Failed to create client. Your entries are still here.");
    } finally { pending.current = false; setSaving(false); }
  };

  return <Sheet open={open} onOpenChange={next => { if (!pending.current) setOpen(next); }}>
    <SheetTrigger asChild><Button size="sm" variant="outline" className="h-8"><Plus className="h-4 w-4 mr-1" /> New</Button></SheetTrigger>
    <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
      <SheetHeader><SheetTitle>New Client</SheetTitle><SheetDescription>Add household contact details and an optional first pet.</SheetDescription></SheetHeader>
      <form className="mt-4" onSubmit={event => { event.preventDefault(); void handleSubmit(); }}>
        <fieldset disabled={saving} className="space-y-4">
          <fieldset disabled={!!createdClientId}>
            <ClientFormFields values={values} idPrefix="new-client" onChange={next => { setValues(next); setDuplicates([]); setReviewedValues(null); }} />
          </fieldset>
          {createdClientId && <p role="status" className="text-sm text-muted-foreground">Client saved. Complete the optional pet below.</p>}
          <div className="border-t pt-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Pet (optional)</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="new-client-pet">Pet name</Label><Input id="new-client-pet" value={petName} onChange={e => setPetName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="new-client-species">Species</Label>
                <Select value={petSpecies} onValueChange={setPetSpecies}><SelectTrigger id="new-client-species"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Dog">Dog</SelectItem><SelectItem value="Cat">Cat</SelectItem><SelectItem value="Bird">Bird</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select>
              </div>
            </div>
          </div>
          {duplicates.length > 0 && !createdClientId && <div role="status" className="rounded-md border p-3 space-y-2 text-sm">
            <p>Possible existing clients. Review these records before creating another household; records will not be merged.</p>
            <ul className="space-y-1">{duplicates.map(client => <li key={client.id}><Link className="text-primary underline" to={`/hub/client/${client.id}`}>{client.full_name}</Link></li>)}</ul>
          </div>}
          {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
          <Button type="submit" className="w-full">{saving ? "Saving…" : createdClientId ? "Finish adding client" : duplicates.length ? "Create separate client" : "Create Client"}</Button>
        </fieldset>
      </form>
    </SheetContent>
  </Sheet>;
}
