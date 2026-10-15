import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { products } from "../api";
import { identityCanonical, parseIdentityRequest, type IdentityEntry, type NamespaceDefinition, type PackageDefinition, type PackageIdentifier } from "./package-model.ts";
import { inventoryIdentityApi } from "./package-api.ts";
import { convertedStockQuantity } from "./quantity-model.ts";
import { normalizedGtin } from "./identifier-model.ts";
import { useIdentityReview, identityError } from "./use-identity-review.ts";
import { IdentityReviewDialog, IdentityReviewStatus } from "./IdentityReviewDialog.tsx";
export const identitySelectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
interface FieldProps { label: string; children: ReactElement<{ id?: string }> }
export function IdentityField({ label, children }: FieldProps) {
  const id = useId(); return <div className="grid min-w-0 gap-1"><Label htmlFor={id}>{label}</Label>{cloneElement(children, { id })}</div>;
}
interface FormProps { entry: IdentityEntry | null; scopes: IdentityEntry[]; close: () => void; saved: () => void }
interface IdentityFormProps extends FormProps { operation: "namespace" | "package" }
export function IdentityForm({ entry, scopes, close, saved, operation: requestedOperation }: IdentityFormProps) {
  const { session, profile, hasRole } = useAuth(), actor = session?.user.id ?? "";
  const operation = entry?.kind ?? requestedOperation;
  const canReview = Boolean(profile?.is_active) && (hasRole("ADMIN") || hasRole("DVM"));
  const [id, setId] = useState(entry?.id ?? crypto.randomUUID()), [expected, setExpected] = useState(entry?.version ?? null);
  const [namespace, setNamespace] = useState<NamespaceDefinition>(entry?.kind === "namespace" ? entry.definition : { supplier: "mwi", account_label: "", catalog_scope: "", active: false });
  const blankPackage: PackageDefinition = { product_id: "", product_version: 1, stock_unit: "", label: "", manufacturer: "", strength: "", form: "", purchase_unit: "", conversion: { stock_units_numerator: "", purchase_units_denominator: "" }, identifiers: [], active: false };
  const [packageValue, setPackageValue] = useState<PackageDefinition>(entry?.kind === "package" ? entry.definition : blankPackage);
  const [note, setNote] = useState(""), [attest, setAttest] = useState(false), [formError, setFormError] = useState(""), [search, setSearch] = useState("");
  const [example, setExample] = useState("1");
  const productQuery = useQuery({ queryKey: ["inventory-identity-products", actor, search], queryFn: () => products(search), enabled: Boolean(actor) && operation === "package" });
  const contextQuery = useQuery({ queryKey: ["inventory-identity-context", actor, entry?.id], queryFn: () => inventoryIdentityApi.history(actor, entry!.id), enabled: Boolean(actor) && entry?.kind === "package" });
  const currentProduct = contextQuery.data?.current_product;
  const baseline = useRef(identityCanonical({ id, expected, namespace, packageValue, note, attest }));
  const [done, setDone] = useState(false);
  const action = useIdentityReview(actor, operation, () => { setDone(true); saved(); close(); }, () => { setDone(true); close(); });
  const frozen = action.busy || action.pending;
  useEffect(() => {
    const original = action.recovered;
    if (!original) return;
    setId(original.id); setExpected(original.expected_version); setNote(original.review_note); setAttest(original.attest_review);
    if (operation === "namespace") setNamespace(original.definition as NamespaceDefinition);
    else setPackageValue(original.definition as PackageDefinition);
  }, [action.recovered, operation]);
  const dirty = !done && (action.pending || baseline.current !== identityCanonical({ id, expected, namespace, packageValue, note, attest }));
  let preview = "";
  if (operation === "package" && packageValue.conversion.stock_units_numerator && packageValue.conversion.purchase_units_denominator) {
    try { preview = `${example} ${packageValue.purchase_unit || "purchase units"} = ${convertedStockQuantity(example, packageValue.conversion)} ${packageValue.stock_unit || "stock units"}`; }
    catch (cause) { preview = identityError(cause); }
  }
  const activeScopes = scopes.filter((item) => item.kind === "namespace" && item.definition.active);
  function changeIdentifier(index: number, value: Partial<PackageIdentifier>) {
    setPackageValue((current) => ({ ...current, identifiers: current.identifiers.map((item, position) => position === index ? { ...item, ...value } : item) }));
  }
  async function submit() {
    setFormError("");
    try {
      const definition = operation === "namespace" ? namespace : {
        ...packageValue,
        identifiers: packageValue.identifiers.map((item) => item.kind === "gtin" ? { ...item, value: normalizedGtin(item.raw_source), namespace_id: null, namespace_version_id: null } : item),
      };
      const request = parseIdentityRequest(operation, { id, expected_version: expected, definition, review_note: note, attest_review: attest });
      await action.save(request);
    } catch (cause) { setFormError(identityError(cause)); }
  }
  return <IdentityReviewDialog title={operation === "namespace" ? "Review supplier scope" : "Review product package"}
    description={operation === "namespace" ? "Identify the purchasing account and catalog used for supplier codes" : "Compare the clinical product, purchase package and exact stock-unit conversion before making codes available for lookup"}
    dirty={dirty} busy={action.busy} pending={action.pending} close={close}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={frozen || !canReview} className="space-y-4 min-w-0">
        {operation === "namespace" ? <div className="grid gap-4 md:grid-cols-2">
          <IdentityField label="Supplier"><select className={identitySelectClass} value={namespace.supplier} disabled={Boolean(entry)} onChange={(event) => setNamespace({ ...namespace, supplier: event.target.value as NamespaceDefinition["supplier"] })}><option value="mwi">MWI Animal Health</option><option value="midwest">Midwest Veterinary Supply</option></select></IdentityField>
          <IdentityField label="Purchasing account label"><Input value={namespace.account_label} disabled={Boolean(entry)} onChange={(event) => setNamespace({ ...namespace, account_label: event.target.value })} placeholder="Practice purchasing account" /></IdentityField>
          <IdentityField label="Catalog scope"><Input value={namespace.catalog_scope} disabled={Boolean(entry)} onChange={(event) => setNamespace({ ...namespace, catalog_scope: event.target.value })} placeholder="Saved product list" /></IdentityField>
          <label className="flex min-h-11 items-center gap-2"><Checkbox checked={namespace.active} onCheckedChange={(checked) => setNamespace({ ...namespace, active: checked === true })} />Make supplier codes available for lookup</label>
        </div> : <>
          {!entry && <IdentityField label="Find catalog product"><Input value={search} onChange={(event) => setSearch(event.target.value)} /></IdentityField>}
          {productQuery.isError && <p role="alert" className="text-destructive">Unable to load catalog products. Refresh before reviewing a package</p>}
          <IdentityField label="Stock product"><select className={identitySelectClass} value={packageValue.product_id} disabled={Boolean(entry) || productQuery.isPending} onChange={(event) => {
            const product = productQuery.data?.find((item) => item.id === event.target.value); if (!product) return;
            setPackageValue({ ...packageValue, product_id: product.id, product_version: product.version, stock_unit: product.unit, label: product.name, manufacturer: product.manufacturer });
          }}><option value="">Choose medication or vaccine</option>{productQuery.data?.filter((product) => product.kind !== "service").map((product) => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}{entry?.kind === "package" && !productQuery.data?.some((product) => product.id === entry.product_id) && <option value={entry.product_id}>{entry.product_snapshot.name}</option>}</select></IdentityField>
          {entry?.kind === "package" && <div className="rounded-xl border bg-muted/40 p-3 space-y-2">
            {contextQuery.isPending && <p role="status">Loading current catalog context…</p>}
            {contextQuery.isError && <p role="alert" className="text-destructive">Unable to verify current catalog context. Refresh before saving</p>}
            {currentProduct && <><p className="text-sm break-words">Current catalog: {currentProduct.name} · {currentProduct.manufacturer || "Manufacturer not recorded"} · {currentProduct.unit}{!currentProduct.active && " · inactive"}</p>
              {currentProduct.version !== packageValue.product_version && <><p className="text-sm">The catalog changed since this package was reviewed. Compare its identity and conversion again</p><Button type="button" variant="outline" className="min-h-11" onClick={() => setPackageValue({ ...packageValue, product_version: currentProduct.version, stock_unit: currentProduct.unit })}>Use current catalog context</Button></>}
            </>}
          </div>}
          <div className="grid gap-4 md:grid-cols-2">
            <IdentityField label="Package label"><Input value={packageValue.label} onChange={(event) => setPackageValue({ ...packageValue, label: event.target.value })} /></IdentityField>
            <IdentityField label="Manufacturer"><Input value={packageValue.manufacturer} onChange={(event) => setPackageValue({ ...packageValue, manufacturer: event.target.value })} /></IdentityField>
            <IdentityField label="Strength or concentration"><Input value={packageValue.strength} onChange={(event) => setPackageValue({ ...packageValue, strength: event.target.value })} placeholder="As printed on the product" /></IdentityField>
            <IdentityField label="Dosage form"><Input value={packageValue.form} onChange={(event) => setPackageValue({ ...packageValue, form: event.target.value })} placeholder="Tablet, injectable…" /></IdentityField>
            <IdentityField label="Purchase unit"><Input value={packageValue.purchase_unit} onChange={(event) => setPackageValue({ ...packageValue, purchase_unit: event.target.value })} placeholder="Bottle, vial, case…" /></IdentityField>
            <IdentityField label="Canonical stock unit"><Input value={packageValue.stock_unit} readOnly /></IdentityField>
            <IdentityField label="Stock units in conversion"><Input inputMode="numeric" value={packageValue.conversion.stock_units_numerator} onChange={(event) => setPackageValue({ ...packageValue, conversion: { ...packageValue.conversion, stock_units_numerator: event.target.value } })} /></IdentityField>
            <IdentityField label="Purchase units in conversion"><Input inputMode="numeric" value={packageValue.conversion.purchase_units_denominator} onChange={(event) => setPackageValue({ ...packageValue, conversion: { ...packageValue.conversion, purchase_units_denominator: event.target.value } })} /></IdentityField>
          </div>
          <div className="rounded-xl border bg-muted/40 p-3 space-y-2"><IdentityField label="Example purchase quantity"><Input inputMode="decimal" value={example} onChange={(event) => setExample(event.target.value)} /></IdentityField><p role="status" className="text-sm break-words">{preview || "Enter both conversion terms to preview the stock quantity"}</p></div>
          <section className="space-y-3" aria-label="Package identifiers"><h3 className="font-display">Supplier codes and manufacturer barcodes</h3>
            {packageValue.identifiers.map((identifier, index) => <div key={index} className="rounded-xl border p-3 space-y-3">
              <IdentityField label={`Identifier ${index + 1} type`}><select className={identitySelectClass} value={identifier.kind} onChange={(event) => {
                const kind = event.target.value as PackageIdentifier["kind"]; changeIdentifier(index, { kind, namespace_id: null, namespace_version_id: null, value: "", raw_source: "" });
              }}><option value="supplier_sku">Supplier SKU</option><option value="supplier_barcode">Supplier printed barcode</option><option value="gtin">Manufacturer UPC / EAN / GTIN</option></select></IdentityField>
              {identifier.kind !== "gtin" && <IdentityField label={`Identifier ${index + 1} supplier scope`}><select className={identitySelectClass} value={identifier.namespace_id ?? ""} onChange={(event) => {
                const scope = activeScopes.find((item) => item.id === event.target.value); changeIdentifier(index, { namespace_id: scope?.id ?? null, namespace_version_id: scope?.version_id ?? null });
              }}><option value="">Choose reviewed supplier account</option>{activeScopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.kind === "namespace" ? `${scope.definition.supplier.toUpperCase()} · ${scope.definition.account_label} · ${scope.definition.catalog_scope}` : ""}</option>)}</select></IdentityField>}
              {identifier.kind !== "gtin" && activeScopes.some((scope) => scope.id === identifier.namespace_id && scope.version_id !== identifier.namespace_version_id) && <div className="space-y-2">
                <p className="text-sm">This supplier scope was reviewed again. Compare its account and catalog before using the current scope</p>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => {
                  const scope = activeScopes.find((item) => item.id === identifier.namespace_id);
                  if (scope) changeIdentifier(index, { namespace_version_id: scope.version_id });
                }}>Use current supplier scope for identifier {index + 1}</Button>
              </div>}
              <IdentityField label={`Identifier ${index + 1} original code`}><Input value={identifier.raw_source} onChange={(event) => changeIdentifier(index, { raw_source: event.target.value, value: event.target.value })} /></IdentityField>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPackageValue({ ...packageValue, identifiers: packageValue.identifiers.filter((_, position) => position !== index) })}>Remove identifier {index + 1}</Button>
            </div>)}
            <Button type="button" variant="outline" className="min-h-11" disabled={packageValue.identifiers.length >= 50} onClick={() => setPackageValue({ ...packageValue, identifiers: [...packageValue.identifiers, { kind: "supplier_sku", namespace_id: null, namespace_version_id: null, value: "", raw_source: "" }] })}>Add package identifier</Button>
          </section>
          <label className="flex min-h-11 items-center gap-2"><Checkbox checked={packageValue.active} onCheckedChange={(checked) => setPackageValue({ ...packageValue, active: checked === true })} />Make reviewed package available for lookup</label>
        </>}
        <IdentityField label="Supplier review note"><Textarea value={note} onChange={(event) => setNote(event.target.value)} /></IdentityField>
        <label className="flex min-h-11 items-start gap-2"><Checkbox checked={attest} onCheckedChange={(checked) => setAttest(checked === true)} /><span>I reviewed the supplier scope, clinical identity and any package conversion for this change</span></label>
      </fieldset>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <IdentityReviewStatus action={action} canReview={canReview} />
      {!action.pending && <Button className="min-h-11" type="submit" disabled={action.busy || !canReview || !attest}>Save supplier review</Button>}
    </form>
  </IdentityReviewDialog>;
}
