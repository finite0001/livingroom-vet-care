import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

export function CreateClientSheet() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState<Database["public"]["Enums"]["channel_type"]>("SMS");
  const [petName, setPetName] = useState("");
  const [petSpecies, setPetSpecies] = useState("Dog");

  const reset = () => { setFirstName(""); setLastName(""); setPhone(""); setEmail(""); setChannel("SMS"); setPetName(""); setPetSpecies("Dog"); };

  const handleSubmit = async () => {
    if (!firstName || !lastName) { toast.error("First and last name are required"); return; }
    setSaving(true);
    try {
      const fullName = `${firstName} ${lastName}`;
      const { data: client, error } = await supabase.from("clients").insert({
        first_name: firstName, last_name: lastName, full_name: fullName,
        primary_phone: phone || null, primary_email: email || null, preferred_channel: channel,
      }).select().single();
      if (error) throw error;
      if (petName && client) {
        const { error: petError } = await supabase.from("pets").insert({ client_id: client.id, name: petName, species: petSpecies });
        if (petError) toast.success(`${fullName} added (pet could not be saved)`);
      }
      toast.success(`${fullName} added`);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      reset(); setOpen(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to create client"); } finally { setSaving(false); }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button size="sm" variant="outline" className="h-8"><Plus className="h-4 w-4 mr-1" /> New</Button></SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader><SheetTitle>New Client</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">First Name *</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Last Name *</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-9 text-sm" /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" className="h-9 text-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 text-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Preferred Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as Database["public"]["Enums"]["channel_type"])}><SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SMS">SMS</SelectItem><SelectItem value="EMAIL">Email</SelectItem><SelectItem value="VOICE">Voice</SelectItem></SelectContent></Select>
          </div>
          <div className="border-t pt-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Pet (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Pet Name</Label><Input value={petName} onChange={(e) => setPetName(e.target.value)} className="h-9 text-sm" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Species</Label>
                <Select value={petSpecies} onValueChange={setPetSpecies}><SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Dog">Dog</SelectItem><SelectItem value="Cat">Cat</SelectItem><SelectItem value="Bird">Bird</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select>
              </div>
            </div>
          </div>
          <Button onClick={handleSubmit} className="w-full" disabled={saving}>{saving ? "Creating..." : "Create Client"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
