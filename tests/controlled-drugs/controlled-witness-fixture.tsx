/** Synthetic mounted UI/raw HTTP composition only. No SQL or genuine Auth. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "../../src/index.css";
import reference from "./record-review-stock-movement-reference.json?raw";
import { witnessFixtureFromBytes } from "./controlled-witness-fixture";
import { WitnessWorkspace, WitnessRecoveryNotice } from "../../src/hub/features/controlled-drugs/witness/WitnessWorkspace";
import { witnessPointerSchema } from "../../src/hub/features/controlled-drugs/witness/schema";
import { ReviewStaffSessionContext } from "../../src/hub/features/controlled-drugs/record-review/staff-session-context";
import { sameReviewIdentity, type ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
const f = witnessFixtureFromBytes(new TextEncoder().encode(reference)), options = new URLSearchParams(location.search);
let identity: Readonly<ReviewIdentity> = Object.freeze(f.identity); const listeners = new Set<() => void>();
const sessions: ReviewStaffSessionSource = { getSnapshot: () => identity, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  isCurrent: expected => sameReviewIdentity(expected, identity), async current() { return { ...identity, accessToken: "synthetic.actual.token" }; } };
function change(next: ReviewIdentity) { identity = Object.freeze(next); for (const notify of listeners) notify(); }
const calls: string[] = [];
let saved = options.has("server_saved"), abandoned = false, lost = false, reads = 0, listReads = 0;
const config = { projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" };
const response = (value: unknown) => new Response(f.encode(value), { headers: { "Content-Type": "application/json" } });
const fetcher: typeof fetch = async (url, init) => {
  const name = String(url).split("/").pop()!; calls.push(name); document.getElementById("calls")!.textContent = calls.join("\n");
  const body = JSON.parse(String(init?.body)).p_request;
  if (body.actor_id !== identity.actorId) throw new Error("Synthetic identity changed");
  if (name === "list_managed_stock_witness_tasks_v1") {
    listReads++;
    if (options.has("delayed") && listReads === 1) await new Promise<void>(resolve => window.addEventListener("fixture-release-old-witness-list", () => resolve(), { once: true }));
    return response({ schema_version: 1, items: identity.actorId === f.entry.identity.actorId ? [] : [f.task], next_cursor: null, has_more: false });
  }
  const pointer = witnessPointerSchema.parse(Object.fromEntries(Object.entries(body).filter(([key]) => !["preparation_digest", "attest_witness"].includes(key))));
  if (identity.actorId === f.entry.identity.actorId || pointer.parent_action_id !== f.pointer.parent_action_id) throw new Error("No source projection for an unqualified parent");
  if (name === "attest_managed_stock_witness_v1") {
    if (abandoned || body.attest_witness !== true || body.preparation_digest !== f.preparationDigest) throw new Error("Synthetic witness save refused");
    saved = true; if (options.has("lost") && !lost) { lost = true; throw new Error("Synthetic saved response lost"); } return response(await f.receipt(pointer));
  }
  if (name === "close_managed_stock_witness_operation_v1" && !saved) abandoned = true;
  if (saved) return response({ ...f.available(pointer), state: "saved", data: { ...f.available(pointer).data, receipt: await f.receipt(pointer) } });
  if (abandoned) return response(f.terminal("abandoned", pointer));
  if (name === "read_managed_stock_witness_operation_v1") return response(f.terminal("not_found", pointer));
  if (name !== "read_managed_stock_witness_v1") throw new Error("Unexpected synthetic route");
  reads++;
  if (options.has("changed") && reads > 1) return response({ ...f.available(pointer), data: { ...f.available(pointer).data, preparation_digest: "b".repeat(64) } });
  return response(f.available(pointer));
};
function Fixture() {
  const [, refresh] = useState(0);
  return <ReviewStaffSessionContext.Provider value={sessions}><header className="space-y-2 border-b p-4"><h1>Synthetic witness browser fixture</h1><p>No genuine Auth, source or physical claim.</p>
    <button type="button" onClick={() => { change({ ...identity, sessionId: "00000000-0000-4000-8000-000000000998", generation: identity.generation + 1 }); refresh(n => n + 1); }}>Renew current login</button>
    <button type="button" onClick={() => { change({ ...f.entry.identity, generation: identity.generation + 1 }); refresh(n => n + 1); }}>Use recorder account</button>
    {options.has("delayed") && <button type="button" onClick={() => window.dispatchEvent(new Event("fixture-release-old-witness-list"))}>Release old-session task response</button>}
  </header><WitnessRecoveryNotice/><WitnessWorkspace connection={config} fetcher={fetcher}/><pre id="calls" className="whitespace-pre-wrap break-all p-4"/></ReviewStaffSessionContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><Fixture/></BrowserRouter>);
