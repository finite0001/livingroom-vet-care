/** Synthetic browser-only service. This fixture proves no real Auth or SQL. */
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router-dom";
import "../../src/index.css";
import { createReviewStaffSessions } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
import { AdministrationWorkspace } from "../../src/hub/features/controlled-drugs/administration/AdministrationWorkspace";
import { createAdministrationClient } from "../../src/hub/features/controlled-drugs/administration/query-client";
import { administrationOptionsReplySchema } from "../../src/hub/features/controlled-drugs/administration/queries";
import { administrationPointerSchema, administrationRequestSchema, type AdministrationReply } from "../../src/hub/features/controlled-drugs/administration/schema";
import { digestAdministrationReceipt, digestAdministrationRequest } from "../../src/hub/features/controlled-drugs/administration/wire";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const broker = createReviewStaffSessions(), claims = btoa(JSON.stringify({ sub: id(1), session_id: id(2), role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const offered = broker.offer({ user: { id: id(1) }, access_token: `e30.${claims}.synthetic` }); broker.allow(offered, true);
const openingScenario = new URLSearchParams(location.search).has("opening");
const offboardingScenario = new URLSearchParams(location.search).has("offboarding"), hasStock = openingScenario || offboardingScenario;
const options = administrationOptionsReplySchema.parse({ schema_version: 1, actor_id: id(1), products: hasStock ? [{ id: id(20), name: "Synthetic controlled medication", version: "1", stock_unit: "mL", draft_version_id: id(21), managed: false }] : [], sites: hasStock ? [{ id: id(10), label: "Synthetic existing site" }] : [], locations: hasStock ? [{ id: id(11), site_id: id(10), label: "Synthetic existing safe", kind: "clinic", initial_custodian_id: null }] : [], staff: [{ id: id(1), name: "Synthetic administrator", roles: ["ADMIN"] }], next_cursor: null, has_more: false });
let original: AdministrationReply | null = null, prepares = 0, executes = 0, reads = 0;
function paint() { for (const [name, value] of [["prepares", prepares], ["executes", executes], ["reads", reads]]) { const element = document.getElementById(String(name)); if (element) element.textContent = String(value); } }
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const client = createAdministrationClient({ projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" }, broker.source, async (url, init) => {
  const method = String(url).split("/").at(-1), input = JSON.parse(init!.body as string).p_request;
  if (method === "prepare_controlled_stock_administration_v1") {
    prepares++; paint(); const request = administrationRequestSchema.parse(input);
    if (request.action !== "site_register" && request.action !== "stock_opening" && request.action !== "review_administration" && request.action !== "review_configuration") throw new Error("Unsupported synthetic action");
    const pointer = administrationPointerSchema.parse({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id, action: request.action, product_id: request.product_id, site_id: request.site_id });
    const created = new Date(), expires = new Date(created.getTime() + 900000), iso = (value: Date) => value.toISOString().replace("Z", "000Z");
    original = { schema_version: 1, state: "prepared", data: { pointer, receipt: null, preparation: { request, request_digest: await digestAdministrationRequest(request), created_at: iso(created), expires_at: iso(expires), source_state: "current",
      summary: request.action === "site_register" ? { site: { id: pointer.site_id, label: request.definition.site.label }, locations: request.definition.locations.map((row, index) => ({ id: id(50 + index), label: row.label, kind: row.kind, initial_custodian_id: row.initial_custodian_id })) } : request.action === "stock_opening" ? { product_id: pointer.product_id, site_id: pointer.site_id, stock_unit: "mL", opening_id: pointer.operation_id, policy_version: "1", slot_count: request.definition.placements.length, observation_count: request.definition.placements.filter(row => row.observed_at !== null).length } : { kind: request.action === "review_administration" ? "administration" : request.definition.kind, scope: request.action === "review_administration" ? { product_id: pointer.product_id, site_id: null, event_kind: null, capability: null } : request.definition.scope, version: "2", record_id: pointer.operation_id } } } };
    return response(original);
  }
  if (method === "execute_controlled_stock_administration_v1") {
    executes++; paint(); if (!original?.data.preparation || original.state !== "prepared") throw new Error("Synthetic original missing");
    const pointer = administrationPointerSchema.parse(input); if (JSON.stringify(pointer) !== JSON.stringify(original.data.pointer)) throw new Error("Synthetic pointer mismatch");
    const receipt = { ...pointer, request_digest: original.data.preparation.request_digest, preparation_id: pointer.operation_id, result_ref: { kind: pointer.action === "site_register" ? "site" as const : pointer.action === "stock_opening" ? "opening" as const : "configuration" as const, id: pointer.operation_id, version: pointer.action === "site_register" || pointer.action === "stock_opening" ? "1" : "2" }, recorded_at: new Date().toISOString().replace("Z", "000Z"), receipt_digest: "0".repeat(64) };
    original = { ...original, state: "saved", data: { ...original.data, receipt: { ...receipt, receipt_digest: await digestAdministrationReceipt(receipt) } } };
    if (new URLSearchParams(location.search).has("lost-save")) throw new Error("Synthetic response lost after commit");
    return response(original);
  }
  if (method === "read_controlled_stock_administration_operation_v1") {
    reads++; paint(); if (!original || JSON.stringify(administrationPointerSchema.parse(input)) !== JSON.stringify(original.data.pointer)) throw new Error("Synthetic operation differs");
    return response(original);
  }
  if (method === "close_controlled_stock_administration_operation_v1") {
    if (!original) throw new Error("Synthetic original missing");
    if (original.state !== "saved") original = { ...original, state: "abandoned", data: { ...original.data, receipt: null } };
    return response(original);
  }
  if (method === "list_controlled_stock_administration_operations_v1") return response({ schema_version: 1, items: [], next_cursor: null, has_more: false });
  if (method === "read_controlled_stock_administration_configuration_v1" && offboardingScenario) return response({ schema_version: 1, state: "configured", data: { kind: input.kind, scope: input.scope, current: { id: id(98), version: "1", enabled: true,
    body: { members: [{ actor_id: new URLSearchParams(location.search).has("role") ? id(1) : id(99), roles: ["DVM"], ...(input.kind === "administration" ? { capabilities: ["audit"] } : {}) }] }, approval_reference: "Synthetic prior approval", published_at: "2026-10-26T12:00:00.000000Z", publisher: { id: id(1), name: "Synthetic prior publisher" } } } });
  if (method === "preview_controlled_stock_opening_v1") return response({ schema_version: 1, state: "available", data: { product: { id: id(20), name: "Synthetic controlled medication", version: "1", stock_unit: "mL" }, draft_version_id: id(21), source_basis_digest: "a".repeat(64), blocked_reason: null,
    slots: [{ slot: { channel: "available", lot_id: id(22), dispense_id: null, allocation_id: null, intake_id: null }, display_label: "Synthetic legacy lot", recorded_quantity: "10.000", custody_state: "onsite", observation_required: true }] } });
  throw new Error("Unsupported synthetic RPC");
});
export function Fixture() {
  const identity = useSyncExternalStore(broker.source.subscribe, broker.source.getSnapshot, broker.source.getSnapshot);
  return <main className="mx-auto min-w-0 max-w-5xl space-y-4 p-4"><p>Synthetic administration. No clinic records or permissions change.</p><Link to="/synthetic-administration-destination">Leave setup</Link><div className="flex gap-3 text-sm"><output id="prepares" aria-label="Synthetic preparations">0</output><output id="executes" aria-label="Synthetic executions">0</output><output id="reads" aria-label="Synthetic reads">0</output></div>{identity && <AdministrationWorkspace key={`${identity.actorId}:${identity.sessionId}:${identity.generation}`} sessions={broker.source} identity={identity} client={client} options={options} onOptionsPage={() => { throw new Error("No synthetic second page"); }} />}</main>;
}
createRoot(document.getElementById("root")!).render(<RouterProvider router={createBrowserRouter([{ path: "*", element: <Fixture /> }])} />);
