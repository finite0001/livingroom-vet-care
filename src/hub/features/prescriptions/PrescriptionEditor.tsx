import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
export interface PrescriptionDraftFields {
  medicationName: string;
  strength: string;
  form: string;
  directions: string;
  route: string;
  quantity: string;
  stockUnit: string;
  refills: string;
  startsOn: string;
  expiresOn: string;
  fulfillmentMode: "" | "practice_stock" | "external_pharmacy";
  productId: string;
  encounterId: string;
}
export interface PrescriptionProductChoice { id: string; name: string; unit: string }
export interface PrescriptionEncounterChoice { id: string; label: string }
interface Props {
  values: PrescriptionDraftFields;
  onChange: (values: PrescriptionDraftFields) => void;
  products: PrescriptionProductChoice[];
  encounters: PrescriptionEncounterChoice[];
  disabled: boolean;
  identity: string;
}
export function PrescriptionEditor({ values, onChange, products, encounters, disabled, identity }: Props) {
  const update = <K extends keyof PrescriptionDraftFields>(key: K, value: PrescriptionDraftFields[K]) => onChange({ ...values, [key]: value });
  const control = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const fields: { key: "medicationName" | "strength" | "form" | "route" | "quantity" | "stockUnit" | "refills"; label: string; maximum: number }[] = [
    { key: "medicationName", label: "Medication name", maximum: 200 }, { key: "strength", label: "Strength", maximum: 200 },
    { key: "form", label: "Dosage form", maximum: 100 }, { key: "route", label: "Route", maximum: 100 },
    { key: "quantity", label: "Maximum quantity per fill", maximum: 20 }, { key: "stockUnit", label: "Quantity unit", maximum: 50 },
    { key: "refills", label: "Additional refills authorized", maximum: 4 },
  ];
  return <fieldset disabled={disabled} className="space-y-4">
    <legend className="font-medium">Prescription draft</legend>
    <p className="text-sm text-muted-foreground">Enter the intended prescription explicitly. Saving a draft does not authorize medication, dispense stock or send an order.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <div><Label htmlFor={`${identity}-mode`}>Dispensing destination</Label><select id={`${identity}-mode`} className={control} value={values.fulfillmentMode} onChange={event => onChange({ ...values, fulfillmentMode: event.target.value as PrescriptionDraftFields["fulfillmentMode"], productId: "" })}><option value="">Select destination</option><option value="practice_stock">Practice stock</option><option value="external_pharmacy">External pharmacy order</option></select></div>
      {values.fulfillmentMode === "practice_stock" && <div><Label htmlFor={`${identity}-product`}>Exact stocked product</Label><select id={`${identity}-product`} className={control} value={values.productId} onChange={event => update("productId", event.target.value)}><option value="">Select product</option>{values.productId && !products.some(p => p.id === values.productId) && <option value={values.productId}>Selected product ID: {values.productId} (not in loaded choices)</option>}{products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">No substitution or unit conversion is implied. Review the medication and quantity unit below.</p></div>}
      {fields.map(field => <div key={field.key}><Label htmlFor={`${identity}-${field.key}`}>{field.label}</Label><Input id={`${identity}-${field.key}`} value={values[field.key]} maxLength={field.maximum} inputMode={field.key === "quantity" ? "decimal" : field.key === "refills" ? "numeric" : "text"} onChange={event => update(field.key, event.target.value)} /></div>)}
      <div><Label htmlFor={`${identity}-start`}>Start date</Label><Input id={`${identity}-start`} type="date" value={values.startsOn} onChange={event => update("startsOn", event.target.value)} /></div>
      <div><Label htmlFor={`${identity}-expiry`}>Authorization expiry date</Label><Input id={`${identity}-expiry`} type="date" value={values.expiresOn} onChange={event => update("expiresOn", event.target.value)} /></div>
      <div><Label htmlFor={`${identity}-encounter`}>Native encounter (optional)</Label><select id={`${identity}-encounter`} className={control} value={values.encounterId} onChange={event => update("encounterId", event.target.value)}><option value="">No encounter selected</option>{values.encounterId && !encounters.some(e => e.id === values.encounterId) && <option value={values.encounterId}>Selected encounter ID: {values.encounterId} (not in loaded choices)</option>}{encounters.map(encounter => <option key={encounter.id} value={encounter.id}>{encounter.label}</option>)}</select></div>
      <div className="md:col-span-2"><Label htmlFor={`${identity}-directions`}>Directions / SIG</Label><Textarea id={`${identity}-directions`} value={values.directions} maxLength={4000} className="min-h-28" onChange={event => update("directions", event.target.value)} /></div>
    </div>
    <p className="text-sm text-muted-foreground">One initial fill plus the additional refills entered above. Partial fills stay within the same fill allowance; closing a partial fill forfeits its unused quantity.</p>
    {values.fulfillmentMode === "external_pharmacy" && <p className="text-sm">An external order does not debit practice stock or establish that a pharmacy filled it. Changing the destination after signing requires a reviewed replacement.</p>}
  </fieldset>;
}
