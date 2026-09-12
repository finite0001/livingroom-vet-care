import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientFormValues } from "./client-form";

interface ClientFormFieldsProps {
  values: ClientFormValues;
  onChange: (values: ClientFormValues) => void;
  idPrefix: string;
}

export function ClientFormFields({ values, onChange, idPrefix }: ClientFormFieldsProps) {
  const change = (field: keyof ClientFormValues, value: string) => onChange({ ...values, [field]: value });
  return <div className="space-y-4">
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-first`}>First name *</Label><Input id={`${idPrefix}-first`} autoComplete="given-name" value={values.first_name} onChange={e => change("first_name", e.target.value)} maxLength={100} required /></div>
      <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-last`}>Last name *</Label><Input id={`${idPrefix}-last`} autoComplete="family-name" value={values.last_name} onChange={e => change("last_name", e.target.value)} maxLength={100} required /></div>
    </div>
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-phone`}>Phone</Label><Input id={`${idPrefix}-phone`} type="tel" maxLength={50} autoComplete="tel" value={values.primary_phone} onChange={e => change("primary_phone", e.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-email`}>Email</Label><Input id={`${idPrefix}-email`} type="email" maxLength={254} autoComplete="email" value={values.primary_email} onChange={e => change("primary_email", e.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-mailing`}>Mailing address</Label><Textarea id={`${idPrefix}-mailing`} autoComplete="street-address" value={values.mailing_address} onChange={e => change("mailing_address", e.target.value)} maxLength={1000} /></div>
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-housecall`}>Housecall address</Label><Textarea id={`${idPrefix}-housecall`} value={values.housecall_address} onChange={e => change("housecall_address", e.target.value)} maxLength={1000} /><p className="text-xs text-muted-foreground">Enter the visit location separately, even if it matches the mailing address.</p></div>
    <div className="space-y-1.5"><Label htmlFor={`${idPrefix}-channel`}>Preferred channel</Label><Select value={values.preferred_channel} onValueChange={value => change("preferred_channel", value)}><SelectTrigger id={`${idPrefix}-channel`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SMS">SMS</SelectItem><SelectItem value="EMAIL">Email</SelectItem><SelectItem value="VOICE">Voice</SelectItem></SelectContent></Select></div>
  </div>;
}
