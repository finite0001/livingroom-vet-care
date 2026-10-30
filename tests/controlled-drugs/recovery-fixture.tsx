/** Presentation controls only. No Auth server, JWT, database or physical stock. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import "../../src/index.css";
import { RecoveryOverview } from "../../src/hub/features/controlled-drugs/recovery/RecoveryOverview";
import type { RecoveryClient } from "../../src/hub/features/controlled-drugs/recovery/client";
import { createRecoveryOperations } from "../../src/hub/features/controlled-drugs/recovery/operation-controller";
import type { RecoveryStatus } from "../../src/hub/features/controlled-drugs/recovery/schema";
import type { CountClient } from "../../src/hub/features/controlled-drugs/count/count-client";
import type { ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";

const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const identity: ReviewIdentity = { actorId: id(1), sessionId: id(2), generation: 1 };
const sessions: ReviewStaffSessionSource = { getSnapshot: () => identity, subscribe: () => () => {}, current: async () => null, isCurrent: value => value === identity };
const time = "2026-10-28T07:00:00.123456Z", native = { boot: time, database_oid: "1", database_name: "postgres" };
const hash = "a".repeat(64);
const evidence = { schema_version: 1 as const, domain: "lrv-narcotics-recovery-evidence-v1" as const, evidence_id: id(8), arm_id: id(3), epoch_id: id(4),
  product_id: id(6), site_id: id(7), actor_id: id(9), session_id: id(10), recorded_at: time, reported_occurred_at: time,
  claim: '<img src=x onerror="alert(1)"> Synthetic staff-reported missing event.', basis: "staff_reported" as const,
  filename: "synthetic-original.txt", mime: "text/plain" as const, byte_length: 1, bytes_hash: hash, record_hash: hash };
const base: RecoveryStatus = { schema_version: 1, actor_id: identity.actorId, session_id: identity.sessionId, is_admin: true, fresh_session: true,
  mode: "armed", head_id: id(5), head_hash: hash, arm_id: id(3), epoch_id: id(4), epoch_started_at: time, latest_epoch_started_at: time,
  needs_new_epoch: false, native_server: native, scopes: [{ product_id: id(6), site_id: id(7) }], evidence: [{ evidence, acknowledgment: null }] };
const countClient = { async scopes() { return { schema_version: 1, items: [{ product_id: id(6), site_id: id(7), product_name: "Synthetic medication", site_name: "Synthetic site", policy_id: null, policy_version: null,
  capabilities: { configure: true, read: true, observe: true, manage: true, reconciliation_prepare: true, reconciliation_approve: true, reconciliation_execute: true, reconciliation_confirm: true, cause_resolve: true } }], has_more: false, next_cursor: null }; } } as Pick<CountClient, "scopes"> as CountClient;
const fail = async (): Promise<never> => { throw new Error("Presentation fixture cannot supply a saved backend result."); };
const client: RecoveryClient = { status: fail, preflight: fail, save: fail, recover: fail, async download() { return { evidence, bytes: new Uint8Array([65]) }; } };
const operations = createRecoveryOperations("a".repeat(20), client, localStorage, { async exclusive(_name, task) { return task(); } });
export function Fixture() {
  const mode = new URLSearchParams(location.search).get("mode"), [epoch, setEpoch] = useState(id(4)), [error, setError] = useState(""), [calls, setCalls] = useState(0);
  const status: RecoveryStatus = mode === "original" ? { ...base, epoch_id: null, epoch_started_at: null, evidence: [] } : { ...base, epoch_id: epoch };
  return <main className="mx-auto max-w-5xl space-y-4 p-4"><h1>Synthetic recovery presentation only</h1>
    <p>No real login, database or physical stock. These controls do not establish backend acceptance.</p>
    <Link to="/other">Leave presentation</Link><button onClick={() => setEpoch(id(11))}>Simulate a new recovery attempt</button>
    <output aria-label="Synthetic saves">{calls}</output><p role="status">{error}</p>
    <RecoveryOverview sessions={sessions} identity={identity} status={status} client={client} operations={operations} countClient={countClient}
      busy={false} locked={false} receipt={null} agreements={[]} work={async task => { try { await task(); } catch { setError("Synthetic response lost. The draft remains available."); } }}
      save={async () => { setCalls(value => value + 1); throw new Error("Synthetic response lost"); }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <Fixture /> }, { path: "/other", element: <p>Other presentation</p> }])} />);
