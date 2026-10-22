# Phase 2 — operational workflows and staff interface

Status: scoped backlog. The [C2a event/policy design](phase-02a-event-policy-design.md)
has independent direction review for a bounded Gate A and exact specification;
its schema, protocol and runtime proofs still require review before implementation.
Depends on phase 1's private canonical installation and
preserves the original 45 requirements. Construction defers real configuration and
physical commissioning, not the engineering and synthetic two-user acceptance.

## Verified gap

The existing staff surface is only C0 medication draft review in
`src/hub/features/controlled-drugs/`. It does not call the secondary-review APIs.
The frozen secondary foundation covers receive, adjust and retract-disposal, with
no configured clinical deadline, witness procedure or ordinary administration and
dispensing target adapters. A new UI alone would not fulfill the approved policy.

## Ordered implementation boundaries

1. **Event coverage and policy.** Independently derive immutable target/site adapters
   for treatment, anesthesia and native dispensing, including supported amendments,
   custody and zero-container annotations. Use original clinical source links, exact
   stock quantities and actual event times; never infer observation from stock delta.
   Introduce versioned reviewed policy/eligibility/calendar configuration with no
   seeded real roster or operating calendar. Define the next staffed-business-day
   deadline against an explicitly configured site timezone/calendar. Preserve the
   distinction between technical preparation expiry and clinical review deadline.
   Recheck actor/session/role/configuration after every blocking lock. New semantics
   require new independently derived versioned expectations; leave v1/v2 untouched.
2. **Record review.** Build bounded typed queue, exact detail packet, prepare/sign,
   cancellation and saved-outcome recovery. Reviewer must be a different person;
   changing browser session does not satisfy separation. The signed meaning says
   record review, not physical observation. Rejection/overdue/unavailable-reviewer
   escalation cannot refund stock or hide an event. Corrections have separate exact
   review targets; no inherited approval. Pagination must preserve empty-but-continuing
   pages without leaking excluded identifiers.
3. **Physical evidence.** Design separate actual-observer attestations and pre-release
   receipt/count controls. Record actual observation time/quantity/source evidence;
   reject retrospective substitution or invented observers. Distinguish review quorum
   from the required actual participants. No solo-housecall waste workaround or
   routine client take-back. Specific future SOPs remain explicit configuration gates.
4. **Counts, transfers and holds.** Two independently recorded counts with stale-state
   detection against intervening movement. No automatic quantity adjustment. Whole
   container relocation has zero stock effect; cross-lot movement has one operation
   with equal opposite lines and stable lock order. Custodian, mobile location and
   controlling registered site remain distinct. Holds compose across investigation,
   expiry, quarantine and other causes; resolving one must not clear the others.
5. **Reports.** Bounded register with exact opening/running/closing quantities, separate
   custody, schedules, patient/owner/supplier/registration evidence where applicable,
   physical and recorded times, original/amendment links, reviews/witnesses/counts and
   preserved form evidence. Private audited exports, formula-safe CSV, printable
   Schedule II and separately retrievable III–V. No automated external filing or purge.
6. **Integration and rehearsal.** Connect each physical writer through the owned prepare/execute wrapper, which
   stores original arguments plus controlled context and invokes the unchanged
   canonical writer once. Never add parameters to frozen writer signatures. Wire
   inventory, patient treatments, anesthesia and native fulfillment to explicit
   product/container selection without double debits or concurrent-form bypasses.
   Use actual synthetic Auth accounts and browser actions, fractional quantities,
   offline/uncertain-save recovery, revocation after observed waits, cancellation and
   late rollback. The real opening UI must not offer a synthetic default count.

## UI and data boundaries

Extend existing feature patterns rather than changing routing or generated types.
Use explicit narrow RPC clients plus runtime response validation. Bind all pending
work to the actor and original request; reauthenticate before and after asynchronous
responses, reject malformed evidence and prevent accidental duplicate mutations.
Signing must show the exact prepared packet and require a deliberate confirmation;
do not reuse C0 draft save’s immediate prepare-to-execute interaction.
Store only safe recovery pointers locally. Show meaningful recovery states without
publishing clinical packets or secret data to localStorage or analytics.

Use existing semantic tokens, mobile-first layout, accessible labeled controls and
44px guided targets. Test two distinct staff accounts, keyboard/mobile flows and
cross-account recovery isolation. No interface should claim the register is active
until the backend's commissioned state says so.

## Proof requirements

Each slice needs immutable-state negative tests, actual Auth and observed contention,
late injected rollback, no lost/duplicated stock, exact original history preservation,
new versioned metadata derivation and restore checks. Keep the independent current
expectations separate from observed catalogs. All source and runtime evidence must
be frozen, bounded and independently reviewed before a PR's exact-head CI/preview.
Physical-after-backup reconciliation remains a separate full recovery gate; a
same-cluster selected-schema restore does not prove it.

## Unresolved implementation details

Before coding each slice, enumerate actual canonical event/source schemas, versioned
migration and descriptor paths, lock graph, authorization surface, immutable request
and response schemas, failure/recovery transitions, test owners and acceptance
fixtures. This scoped backlog does not itself authorize an underspecified protocol.
Practice-specific facts are deferred until opening; none need to be invented to
complete synthetic engineering acceptance.
