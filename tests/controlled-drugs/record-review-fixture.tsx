/** Test-only presentation fixture; no Auth, backend, signing or provider calls. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RecordReviewQueue } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewQueue";
import { verifyReviewQueuePage } from "../../src/hub/features/controlled-drugs/record-review/queue-model";
import "../../src/index.css";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", product = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", site = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const scope = { actor_id: actor, product_id: product, site_id: site, event_kind: "receive_inventory", view: "site" };
const request = { ...scope, page_size: 50, cursor: null };
const cursor = { version: 3, ...scope, after_sequence: "9007199254740993", high_water: "9223372036854775807", read_eligibility_id: actor, read_authorization_hash: "a".repeat(64) };
const empty = verifyReviewQueuePage(request, { version: 3, state: "page", data: { items: [], next_cursor: cursor, high_water: cursor.high_water, examined: 100, coverage: "bounded_page" } });
const page = verifyReviewQueuePage({ ...request, cursor }, { version: 3, state: "page", data: { items: [{
  event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", event_sequence: "9007199254740994", event_kind: "receive_inventory", site_basis: "event_transitions", site_id: site,
  observed_at: "2026-10-22T01:02:03.000001Z", recorded_at: "2026-10-23T01:02:03.000002Z", review_state: "rejected", deadline_state: "completed_time_unassessable",
  deadline_basis: "historical_policy_unavailable", due_at: null, unavailable_reason: "no_policy_at_anchor", signing_state: "terminal", signing_reason: "terminal_outcome",
}], next_cursor: null, high_water: cursor.high_water, examined: 1, coverage: "bounded_page" } });
export function Fixture() {
  const [continued, setContinued] = useState(false), [opened, setOpened] = useState("");
  return <main className="mx-auto max-w-5xl p-4 md:p-8"><p className="mb-6 text-sm">Synthetic presentation fixture · no clinical actions</p>
    <RecordReviewQueue page={continued ? page : empty} busy={false} openRecord={setOpened} nextPage={() => setContinued(true)} restart={() => { setContinued(false); setOpened(""); }} />
    {opened && <p role="status" className="mt-4">Synthetic record opened</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
