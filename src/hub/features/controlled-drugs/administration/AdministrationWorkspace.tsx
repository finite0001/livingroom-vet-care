import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "../../clinical/use-unsaved-changes";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { administrationRequestSchema, type AdministrationPointer, type AdministrationReply, type AdministrationRequest } from "./schema.ts";
import { browserAdministrationLocks, createAdministrationOperations, type AdministrationOperationResult } from "./operation-controller.ts";
import type { AdministrationClient } from "./query-client.ts";
import type { AdministrationOptions, AdministrationOperationsPage, AdministrationProduct, CurrentStockPolicy, StockOpeningPreview } from "./queries.ts";
import type { AdministrationConfiguration, AdministrationConfigurationRequest } from "./configuration-query.ts";
import { SelectField, CheckField } from "./FormFields";
import { SiteRegistrationForm } from "./SiteRegistrationForm";
import { StockOpeningForm } from "./StockOpeningForm";
import { StockPolicyRevisionForm } from "./StockPolicyRevisionForm";
import { ReviewAccessForm } from "./ReviewAccessForm";
import { ReviewPolicyForm } from "./ReviewPolicyForm";
import { ReviewCalendarForm } from "./ReviewCalendarForm";
import { AdministrationReview } from "./AdministrationReview";
import { reviewEventKindSchema } from "../record-review/queue-model.ts";
import { reviewEventLabels } from "../record-review/review-labels.ts";
import type { ReviewConfigurationScope } from "./review-configuration-definition.ts";

interface AdministrationWorkspaceProps { readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly client: AdministrationClient; readonly options: AdministrationOptions; readonly onOptionsPage: (page: AdministrationOptions) => void }
type EditorKind = "site_register" | "stock_opening" | "stock_policy" | "administration" | "eligibility" | "routing" | "calendar" | "policy";
interface LoadedEditor { readonly kind: EditorKind; readonly productId: string | null; readonly siteId: string | null; readonly configurationScope: ReviewConfigurationScope | null;
  readonly opening: StockOpeningPreview | null; readonly stockPolicy: CurrentStockPolicy | null; readonly configuration: AdministrationConfiguration | null; readonly calendar: AdministrationConfiguration | null; readonly routing: AdministrationConfiguration | null }
const editorChoices = [{ value: "site_register", label: "Register a site and locations" }, { value: "stock_opening", label: "Establish opening stock" }, { value: "stock_policy", label: "Revise stock permissions" }, { value: "administration", label: "Review administrators" }, { value: "eligibility", label: "Staff record access" }, { value: "calendar", label: "Staffed review calendar" }, { value: "routing", label: "Escalation recipients" }, { value: "policy", label: "Independent record-review policy" }];
export function AdministrationWorkspace({ sessions, identity, client, options, onOptionsPage }: AdministrationWorkspaceProps) {
  const [kind, setKind] = useState(""), [product, setProduct] = useState(""), [site, setSite] = useState(""), [eventKind, setEventKind] = useState(""), [capability, setCapability] = useState("");
  const [loaded, setLoaded] = useState<LoadedEditor | null>(null), [reply, setReply] = useState<AdministrationReply | null>(null), [history, setHistory] = useState<AdministrationOperationsPage | null>(null);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [reviewed, setReviewed] = useState(false), [confirmSave, setConfirmSave] = useState(false), [message, setMessage] = useState("");
  const [cleanupPending, setCleanupPending] = useState(false), [revision, setRevision] = useState(0), [discard, setDiscard] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [medicationLookup, setMedicationLookup] = useState<{ operation: string; cursor: { product_id: string } | null; done: boolean; product: AdministrationProduct | null } | null>(null);
  const inflight = useRef(false), alive = useRef(true), formOperation = useRef<string | null>(null);
  const operations = useMemo(() => createAdministrationOperations(client, { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }, browserAdministrationLocks()), [client]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const changed = () => setRevision(value => value + 1); window.addEventListener("storage", changed); window.addEventListener("focus", changed); return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", changed); }; }, []);
  const guard = useUnsavedChanges(dirty || reviewed, "Administrator entries have not been saved. Leaving discards unsaved fields. A prepared or uncertain operation remains available for recovery.");
  let pending: AdministrationPointer | null = null, blocked = false;
  try { pending = operations.pending(identity.actorId); } catch { blocked = true; }
  const active = () => alive.current && sessions.isCurrent(identity);
  async function run(work: () => Promise<void>, propagate = false) {
    if (inflight.current || !active()) { if (propagate) throw new ControlledOperationNotSentError(); return; }
    inflight.current = true; setBusy(true); setMessage("");
    try { await work(); }
    catch (cause) {
      if (active() && !(cause instanceof ControlledOperationNotSentError)) setUncertain(true);
      if (active()) setMessage(cause instanceof ControlledOperationNotSentError ? "This action was not sent. Your entries are preserved." : "The result could not be confirmed. Read the original operation before starting another.");
      if (propagate) { if (cause instanceof ControlledOperationNotSentError) throw cause; throw new Error("Check administrator operation recovery."); }
    } finally { inflight.current = false; if (active()) { setBusy(false); setRevision(value => value + 1); } }
  }
  function accept(result: AdministrationOperationResult) {
    if (!active()) return;
    setReply(result.reply); setCleanupPending(result.cleanup_pending); setUncertain(false); setReviewed(false); setConfirmSave(false);
    if (result.reply.state === "saved" || result.reply.state === "abandoned") { setDirty(false); setLoaded(null); formOperation.current = null; }
    setMessage(result.reply.state === "saved" ? "The original administrator change was saved." : result.reply.state === "abandoned" ? "The original operation is closed without a save." : result.reply.state === "prepared" ? "Preparation loaded. Review the complete change before saving." : result.reply.state === "expired" ? "This preparation expired. Close it before preparing a fresh change." : "No preparation exists yet. Close this original attempt before starting another.");
  }
  async function loadEditor() {
    if (dirty || pending || blocked || !editorChoices.some(choice => choice.value === kind)) return;
    const selected = kind as EditorKind;
    const chosenProduct = options.products.find(row => row.id === product), chosenSite = options.sites.find(row => row.id === site);
    if (selected !== "site_register" && !chosenProduct || selected !== "site_register" && selected !== "administration" && !(selected === "eligibility" && capability === "exception_read") && !chosenSite) throw new Error("Choose an actual medication and site.");
    const base: LoadedEditor = { kind: selected, productId: selected === "site_register" ? null : product, siteId: selected === "site_register" || selected === "administration" || selected === "eligibility" && capability === "exception_read" ? null : site,
      configurationScope: null, opening: null, stockPolicy: null, configuration: null, calendar: null, routing: null };
    let value = base;
    if (selected === "stock_opening") {
      if (!chosenProduct?.draft_version_id || chosenProduct.managed) throw new Error("Read an eligible uncommissioned medication with a current draft.");
      value = { ...base, opening: await client.preview({ schema_version: 1, actor_id: identity.actorId, product_id: product, draft_version_id: chosenProduct.draft_version_id }, identity) };
    } else if (selected === "stock_policy") value = { ...base, stockPolicy: await client.stockPolicy({ schema_version: 1, actor_id: identity.actorId, product_id: product, site_id: site }, identity) };
    else if (selected !== "site_register") {
      const scope: ReviewConfigurationScope = { product_id: product, site_id: base.siteId, event_kind: selected === "eligibility" && capability !== "exception_read" ? reviewEventKindSchema.parse(eventKind) : null,
        capability: selected === "eligibility" ? capability as "read" | "review" | "exception_read" : null };
      const configuration = await client.configuration({ schema_version: 1, actor_id: identity.actorId, kind: selected, scope } satisfies AdministrationConfigurationRequest, identity);
      if (!active()) return;
      value = { ...base, configurationScope: scope, configuration };
      if (selected === "policy") {
        const calendar = await client.configuration({ schema_version: 1, actor_id: identity.actorId, kind: "calendar", scope }, identity); if (!active()) return;
        const routing = await client.configuration({ schema_version: 1, actor_id: identity.actorId, kind: "routing", scope }, identity); value = { ...value, calendar, routing };
      }
    }
    if (active()) { setLoaded(value); setReply(null); setReviewed(false); setConfirmSave(false); formOperation.current = crypto.randomUUID(); }
  }
  function prepare(definition: unknown) {
    return run(async () => {
      if (!loaded || !formOperation.current || blocked || operations.pending(identity.actorId)) throw new ControlledOperationNotSentError();
      const action = loaded.kind === "administration" ? "review_administration" : ["site_register", "stock_opening", "stock_policy"].includes(loaded.kind) ? loaded.kind : "review_configuration";
      let request: AdministrationRequest;
      try { request = administrationRequestSchema.parse({ schema_version: 1, actor_id: identity.actorId, operation_id: formOperation.current, action,
        product_id: loaded.productId, site_id: action === "site_register" ? formOperation.current : loaded.siteId, definition }); }
      catch { throw new ControlledOperationNotSentError(); }
      accept(await operations.prepare(request, identity));
    }, true);
  }
  function clearEditor() { setLoaded(null); setDirty(false); setReply(null); setReviewed(false); setConfirmSave(false); setDiscard(false); formOperation.current = null; }
  const locked = busy || !!pending || blocked, preparation = reply?.data.preparation ?? null;
  const recoveredProduct = medicationLookup?.operation === reply?.data.pointer.operation_id ? medicationLookup?.product : null;
  const reviewOptions = recoveredProduct && !options.products.some(row => row.id === recoveredProduct.id) ? { ...options, products: [...options.products, recoveredProduct] } : options;
  const needsMedication = !!preparation?.request.product_id && !reviewOptions.products.some(row => row.id === preparation.request.product_id);
  const canExecute = !uncertain && !needsMedication && reply?.state === "prepared" && preparation?.source_state === "current" && preparation.expires_at > new Date().toISOString().replace("Z", "000Z") && pending?.operation_id === reply.data.pointer.operation_id;
  const localPending = pending;
  const knownPreparation = !uncertain && reply?.state === "prepared" && pending?.operation_id === reply.data.pointer.operation_id;
  const knownSaved = !uncertain && reply?.state === "saved";
  void revision; // Storage/focus invalidations cause a fresh synchronous pointer read.
  return <section className="min-w-0 space-y-5" aria-label="Controlled stock administration">{guard}{message && <p role="status" className="break-words">{message}</p>}{blocked && <p role="alert" className="text-destructive">The browser’s operation record could not be read safely. Ask an administrator to recover your saved operation; do not clear browser storage to bypass it.</p>}
    {(pending || cleanupPending) && <section className="space-y-3 rounded-xl border p-4" aria-label="Administrator operation recovery"><h2 className="font-display text-xl">{knownPreparation ? "Prepared operation" : knownSaved ? "Finish receipt recovery" : "Check the original operation"}</h2><p className="text-sm text-muted-foreground">{knownPreparation ? "Review the change below, then save it deliberately or close this preparation." : knownSaved ? "The saved receipt is verified. Read it again to finish clearing this browser’s pending reference." : "An uncertain result must be read or explicitly closed before another preparation."}</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" variant="outline" disabled={busy || blocked} onClick={() => void run(async () => { if (localPending) accept(await operations.recover("read", identity)); else if (reply) accept(await operations.readOwned(reply.data.pointer, identity)); })}>Read original result</Button><Button type="button" className="min-h-11" variant="outline" disabled={busy || blocked || !pending} onClick={() => void run(async () => accept(await operations.recover("close", identity)))}>Close original attempt</Button></div></section>}
    {needsMedication && reply && <section className="space-y-3 rounded-xl border p-4" aria-label="Recover medication identity"><p>Load the medication’s current name before reviewing this recovered operation. The prepared quantities and units remain the original captured values.</p><Button type="button" className="min-h-11" variant="outline" disabled={busy || medicationLookup?.operation === reply.data.pointer.operation_id && medicationLookup.done} onClick={() => void run(async () => {
      const target = reply.data.pointer.product_id!, op = reply.data.pointer.operation_id!, cursor = medicationLookup?.operation === op ? medicationLookup.cursor : null;
      const page = await client.options({ schema_version: 1, actor_id: identity.actorId, cursor, page_size: 100 }, identity); if (!active()) return;
      const found = page.products.find(row => row.id === target) ?? null, more = !found && page.has_more && page.products[page.products.length - 1].id! < target;
      setMedicationLookup({ operation: op, cursor: more ? { product_id: page.next_cursor!.product_id! } : null, done: !more, product: found }); setReviewed(false); setConfirmSave(false);
      setMessage(found ? "Medication name loaded. Review the complete original change." : more ? "This medication is on a later page. Load the next page to continue." : "No authorized current medication record was found. Close this preparation and ask an administrator to check the catalog.");
    })}>{medicationLookup?.operation === reply.data.pointer.operation_id && !medicationLookup.done ? "Load next medication page" : "Load medication name"}</Button></section>}
    {preparation && <AdministrationReview preparation={preparation} options={reviewOptions} />}
    {reply?.state === "prepared" && preparation && <section className="space-y-3" aria-label="Confirm administrator change"><CheckField checked={reviewed} onChange={value => { setReviewed(value); setConfirmSave(false); }}>I reviewed the complete prepared change and its staff, locations, permissions, and references.</CheckField>{!confirmSave ? <Button type="button" className="min-h-11" disabled={busy || !canExecute || !reviewed} onClick={() => setConfirmSave(true)}>Continue to save</Button> : <div className="space-y-3 rounded-xl border p-4"><p>Save this exact reviewed change? It becomes part of the permanent register.</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy || !canExecute || !reviewed} onClick={() => void run(async () => accept(await operations.execute(preparation, identity)))}>Save reviewed change</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmSave(false)}>Keep reviewing</Button></div></div>}</section>}
    {reply?.data.receipt && <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="Saved administrator receipt"><h2 className="font-display text-xl">Saved receipt</h2><p>Recorded {reply.data.receipt.recorded_at} · version {reply.data.receipt.result_ref.version}</p><p className="break-all text-xs text-muted-foreground">Reference: {reply.data.receipt.operation_id}</p></section>}
    {!loaded && !pending && !blocked && <section className="space-y-4" aria-label="Choose administrator change"><h2 className="font-display text-xl">Administrator setup</h2><fieldset disabled={busy} className="space-y-3"><SelectField label="What needs to change?" value={kind} onChange={value => { setKind(value); setProduct(""); setSite(""); setCapability(""); setEventKind(""); }} choices={editorChoices} />{kind && kind !== "site_register" && <SelectField label="Medication" value={product} onChange={setProduct} choices={options.products.map(row => ({ value: row.id!, label: `${row.name} · ${row.stock_unit}` }))} />}{kind === "eligibility" && <SelectField label="Access capability" value={capability} onChange={value => { setCapability(value); setSite(""); setEventKind(""); }} choices={[{ value: "read", label: "Read movement records" }, { value: "review", label: "Independently review movement records" }, { value: "exception_read", label: "Read medication exceptions across sites" }]} />}{kind && kind !== "site_register" && kind !== "administration" && !(kind === "eligibility" && capability === "exception_read") && <SelectField label="Registered site" value={site} onChange={setSite} choices={options.sites.map(row => ({ value: row.id!, label: row.label! }))} />}{kind === "eligibility" && capability !== "exception_read" && <SelectField label="Record kind" value={eventKind} onChange={setEventKind} choices={reviewEventKindSchema.options.map(value => ({ value, label: reviewEventLabels[value] }))} />}<Button type="button" className="min-h-11" disabled={!kind} onClick={() => void run(loadEditor)}>Read current records and open form</Button>{options.has_more && <Button type="button" variant="outline" className="min-h-11" onClick={() => void run(async () => { const page = await client.options({ schema_version: 1, actor_id: identity.actorId, cursor: options.next_cursor, page_size: 100 }, identity); if (active()) { setProduct(""); setReply(null); onOptionsPage(page); } })}>Next medication page</Button>}</fieldset></section>}
    {loaded && !preparation && <section className="space-y-4"><Button type="button" className="min-h-11" variant="outline" disabled={locked} onClick={() => dirty ? setDiscard(true) : clearEditor()}>Choose a different setup action</Button>{discard && <div role="alertdialog" aria-label="Discard administrator draft" className="space-y-3 rounded-xl border p-4"><p>Discard these unsaved administrator entries?</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={clearEditor}>Discard entries</Button><Button type="button" className="min-h-11" variant="outline" onClick={() => setDiscard(false)}>Keep editing</Button></div></div>}
      {loaded.kind === "site_register" && <SiteRegistrationForm staff={options.staff} disabled={locked} onSubmit={prepare} onDirtyChange={() => setDirty(true)} />}
      {loaded.opening && <StockOpeningForm preview={loaded.opening} options={options} disabled={locked} onSubmit={prepare} onDirtyChange={() => setDirty(true)} />}
      {loaded.stockPolicy && <StockPolicyRevisionForm current={loaded.stockPolicy} options={options} disabled={locked} onSubmit={prepare} onDirtyChange={() => setDirty(true)} />}
      {loaded.configuration && loaded.configurationScope && ["administration", "eligibility", "routing"].includes(loaded.kind) && <ReviewAccessForm kind={loaded.kind as "administration" | "eligibility" | "routing"} current={loaded.configuration} scope={loaded.configurationScope} staff={options.staff} disabled={locked} onSubmit={prepare} onDirtyChange={() => setDirty(true)} />}
      {loaded.kind === "policy" && loaded.configuration && loaded.configurationScope && loaded.calendar && loaded.routing && <ReviewPolicyForm current={loaded.configuration} scope={loaded.configurationScope} calendar={loaded.calendar} routing={loaded.routing} disabled={locked} onSubmit={prepare} onDirtyChange={() => setDirty(true)} />}
      {loaded.kind === "calendar" && loaded.configuration && loaded.configurationScope && <ReviewCalendarForm current={loaded.configuration} scope={loaded.configurationScope} disabled={locked} project={(zone, values) => client.projectCalendar({ schema_version: 1, actor_id: identity.actorId, product_id: loaded.productId, site_id: loaded.siteId, zone, local_values: values }, identity)} onSubmit={prepare} onDirtyChange={() => setDirty(true)} />}
    </section>}
    <section className="space-y-3" aria-label="Your administrator operations"><h2 className="font-display text-xl">Your saved and interrupted operations</h2><Button type="button" variant="outline" className="min-h-11" disabled={busy || dirty || !!pending || blocked} onClick={() => void run(async () => { const page = await client.operations({ schema_version: 1, actor_id: identity.actorId, cursor: null, page_size: 25 }, identity); if (active()) setHistory(page); })}>Read my operations</Button>{history && <ul className="space-y-2">{history.items.map(row => <li key={row.pointer.operation_id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p>{row.pointer.action.replace(/_/g, " ")} · {row.state}</p><p className="text-sm text-muted-foreground">{row.created_at}</p></div><Button type="button" variant="outline" className="min-h-11" disabled={busy || dirty || !!pending || blocked} onClick={() => void run(async () => accept(await operations.readOwned(row.pointer, identity)))}>Read operation</Button></li>)}</ul>}{history?.has_more && <Button type="button" className="min-h-11" variant="outline" disabled={busy || dirty || !!pending || blocked} onClick={() => void run(async () => { const page = await client.operations({ schema_version: 1, actor_id: identity.actorId, cursor: history.next_cursor, page_size: 25 }, identity); if (active()) setHistory(page); })}>Earlier operations</Button>}</section>
  </section>;
}
