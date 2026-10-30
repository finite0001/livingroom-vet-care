/** Synthetic presentation only. No Auth server, JWT, database or physical stock. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import "../../src/index.css";
import { RegisterWorkspace } from "../../src/hub/features/controlled-drugs/register/RegisterWorkspace";
import { createRegisterOperations } from "../../src/hub/features/controlled-drugs/register/operation-controller";
import { browserCountOperationLock } from "../../src/hub/features/controlled-drugs/count/count-operation-controller";
import type { RegisterClient } from "../../src/hub/features/controlled-drugs/register/client";
import { registerReportRequest, registerReportSaved, type RegisterReply } from "../../src/hub/features/controlled-drugs/register/schema";
import { registerSha } from "../../src/hub/features/controlled-drugs/register/wire";
import type { ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
let identity: ReviewIdentity | null = { actorId: id(1), sessionId: id(90), generation: 1 }, calls = 0;
const saved = new Map<string, RegisterReply>(), listeners = new Set<() => void>();
const sessions: ReviewStaffSessionSource = { getSnapshot: () => identity, subscribe: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  current: async () => null, isCurrent: candidate => identity?.actorId === candidate.actorId && identity.sessionId === candidate.sessionId && identity.generation === candidate.generation };
const client: RegisterClient = {
  async save(kind, input) {
    calls++; document.getElementById("synthetic-calls")!.textContent = String(calls);
    if (new URLSearchParams(location.search).has("unknown")) throw new Error("Synthetic lost response; recover the original operation.");
    if (kind !== "report") throw new Error("Synthetic supporting-file test uses the lost-response case.");
    const request = registerReportRequest.parse(input), captured = "2026-10-28T07:00:00.123456Z";
    const dataset = { schema_version: 1, report_id: request.operation_id, request, captured_at: captured, time_basis: "Synthetic presentation fixture", schedule: "II",
      product_name: '<img src=x onerror="alert(1)"> Synthetic medication', stock_unit: "mL", site_label: "Synthetic site", registration_evidence_text: "{}", opening_evidence_text: "{}", authorization_kinds: [],
      cells: [{ cell_id: id(6), container_id: id(7), label: "Synthetic bottle", kind: "stock", lot_id: id(8), channel: "available", stock_unit: "mL", opening_quantity: "1.250", closing_quantity: "1.375", period_opening_entry: null,
        custody_at_start: { status: "onsite", location_id: id(9), custodian_id: id(1) }, custody_at_end: { status: "onsite", location_id: id(9), custodian_id: id(1) } }],
      events: [{ event_id: id(100 + calls), sequence: String(calls), writer: "append_native_dispense_correction", event_kind: "append_native_dispense_correction:clinical_annotation", actor_id: id(1), actor_name: "Synthetic recorder",
        observed_at: null, recorded_at: captured, basis: "annotation", note: "Synthetic nonphysical annotation", record_hash: "a".repeat(64), secondary_review_required: true, lines: [], custody_text: "[]", source_packet_text: "{}",
        source_packet_hash: await registerSha(new TextEncoder().encode("{}")), review_history_text: '{"terminal_review":null,"escalations":[]}', review_history_hash: await registerSha(new TextEncoder().encode('{"terminal_review":null,"escalations":[]}')), saved_witnesses: [], current_display: null }],
      counts: [], supporting_forms: [], evidence_gaps: ["Synthetic presentation only; this is not clinical evidence."] };
    const text = JSON.stringify(dataset), csv = '"Synthetic header"\r\n"\'=Synthetic text"\r\n';
    const result = registerReportSaved.parse({ schema_version: 1, state: "saved", kind, operation_id: request.operation_id, actor_id: id(1), original_session_id: id(90), recorded_at: captured,
      request_metadata: request, request_hash: "a".repeat(64), data: { captured_at: captured, dataset_text: text, dataset_hash: await registerSha(new TextEncoder().encode(text)), dataset_utf8_bytes: new TextEncoder().encode(text).length,
        csv_text: csv, csv_hash: await registerSha(new TextEncoder().encode(csv)), csv_utf8_bytes: new TextEncoder().encode(csv).length } });
    saved.set(request.operation_id, result); return result;
  },
  async recover(mode, pointer) { return saved.get(pointer.operation_id) ?? { schema_version: 1, state: mode === "close" ? "abandoned" : "not_found", operation_id: pointer.operation_id, kind: pointer.kind }; },
  async list() { return { schema_version: 1, actor_id: id(1), product_id: id(4), site_id: id(5), items: [...saved.values()].filter(value => value.state === "saved" && value.kind === "report").map(value => ({ operation_id: value.operation_id, recorded_at: "2026-10-28T07:00:00.123456Z", captured_at: "2026-10-28T07:00:00.123456Z", from_at: "2026-10-20T00:00:00.000Z", to_at: "2026-10-21T00:00:00.000Z" })), has_more: false, next_operation_id: null }; },
  async download() { throw new Error("No synthetic original file"); },
};
const operations = createRegisterOperations("a".repeat(20), client, localStorage, browserCountOperationLock());
function Fixture() {
  const [active, setActive] = useState(true);
  return <main className="mx-auto max-w-4xl space-y-4 p-4"><p>Synthetic presentation only. No real login, database or physical stock.</p>
    <button onClick={() => { identity = null; setActive(false); listeners.forEach(listener => listener()); }}>Clear synthetic presentation identity</button>
    <output id="synthetic-calls" aria-label="Synthetic mutation calls">{calls}</output>
    {active && identity ? <RegisterWorkspace sessions={sessions} identity={identity} client={client} operations={operations} productId={id(4)} siteId={id(5)} /> : <p role="status">Synthetic presentation identity cleared.</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <Fixture /> }])} />);
