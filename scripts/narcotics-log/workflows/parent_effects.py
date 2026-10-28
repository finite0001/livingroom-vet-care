"""Prospective original-relation effects from the fixed API source schedules.

Counts are declared before execution. Every pre-existing row remains protected
by the complete original-row multiset, including tables absent from this map.
"""
import full121_values as values
import full121_queries as sql
def commissioning_parent_additions(grants):
    result = {}
    def add(count, *tables):
        for table in tables:
            if table in result:
                raise ValueError("Duplicate prospective relation effect")
            result[table] = count
    add(2, "auth.users", "auth.identities", "public.profiles")
    add(grants, "auth.sessions", "auth.refresh_tokens", "auth.mfa_amr_claims")
    add(2 + grants, "auth.audit_log_entries")
    add(3, "public.user_roles", "public.audit_logs", "public.controlled_stock_state_events")
    add(2, "public.controlled_stock_policy_versions", "public.controlled_stock_policy_sites")
    add(7, "controlled_review_v3.configuration", "controlled_review_v3.publications")
    add(1, "public.catalog_products", "public.inventory_lots", "public.inventory_movements",
        "public.stock_movement_sources", "public.stock_writer_admissions",
        "public.controlled_draft_entries", "public.controlled_draft_versions",
        "public.controlled_draft_reviews", "public.controlled_draft_actions",
        "public.controlled_stock_sites", "public.controlled_stock_locations",
        "public.controlled_stock_states", "public.controlled_stock_openings",
        "public.controlled_stock_opening_movements", "public.controlled_stock_containers",
        "public.controlled_stock_container_heads", "public.controlled_stock_cells",
        "public.controlled_stock_positions")
    return result


def verify_admissions(context, proof, query):
    actor = values.uid(context["users"][0]["id"])
    allowed = {("receive_inventory", values.uid(context["ids"]["legacy_receive"]))}
    for entry in proof.get("writes", []):
        allowed.add((entry["writer"], values.uid(entry["pointer"]["operation_id"])))
    if "gateway" in context:
        allowed.add(("adjust_inventory", values.uid(context["gateway"]["pointer"]["operation_id"])))
    if "witness" in context:
        allowed.add(("adjust_inventory", values.uid(context["witness"]["parent_pointer"]["operation_id"])))
    if "management" in context:
        allowed.add(("adjust_inventory", values.uid(context["management"]["parent_action_id"])))
    if "historical_nonstock" in proof:
        allowed.add(("record_patient_treatment", values.uid(proof["historical_nonstock"]["request"]["p_id"])))
    pairs = ",".join("('" + writer + "','" + identifier + "'::uuid)" for writer, identifier in sorted(allowed))
    program = sql.read("""select jsonb_build_object(
 'rows',(select coalesce(jsonb_agg(to_jsonb(a)order by backend_pid),'[]'::jsonb)from public.stock_writer_admissions a),
 'native_source_bounds',(select coalesce(bool_and(backend_pid>0 and server_started_at=pg_postmaster_start_time()
 and transaction_id>0 and transaction_id<txid_current()
 and transaction_started_at>=server_started_at and statement_started_at>=transaction_started_at
 and statement_started_at<=clock_timestamp() and actor_id='""" + actor + """'::uuid
 and(writer,source_id)in(""" + pairs + """)),false)from public.stock_writer_admissions));""")
    actual = query("source-bound-writer-admissions", program)
    rows = actual["rows"]
    if actual["native_source_bounds"] is not True or not 1 <= len(rows) <= len(allowed):
        raise ValueError("Native writer admission cache escaped the finite actual request schedule")
    keys = {"backend_pid", "server_started_at", "transaction_id", "transaction_started_at", "statement_started_at", "writer", "source_id", "actor_id"}
    if any(set(row) != keys or row["actor_id"] != actor or (row["writer"], row["source_id"]) not in allowed for row in rows):
        raise ValueError("Writer admission does not belong to an original actual request")
    return {"source_bound_admissions": len(rows), "source_requests": len(allowed), "native_bounds_verified": True}


def expected(profile, grants):
    if profile == "record_review_signing":
        result = expected("ordinary_none", grants)
        result.update({"controlled_review_v3." + name: 1 for name in ("operation_claims", "preparations", "decisions", "obligations")})
        return result
    result = commissioning_parent_additions(grants)

    def add(count, *names):
        for name in names:
            key = "public." + name
            result[key] = result.get(key, 0) + count

    # One actual physical source link per posted event; annotation and pickup
    # still have source records even when they create no inventory movement.
    if profile == "scalars":
        add(2, "inventory_movements", "stock_movement_sources", "audit_logs")
        add(1, "controlled_stock_containers", "controlled_stock_container_heads", "controlled_stock_cells", "controlled_stock_positions")
    elif profile == "clinical":
        add(1, "clients", "pets", "clinical_recap_epochs", "billing_invoices", "patient_anesthesia_records", "anesthesia_record_revisions", "anesthesia_drug_administrations")
        add(3, "patient_treatments")
        add(2, "billing_invoice_items", "inventory_movements", "stock_movement_sources")
        # Household/pet INSERTs(2), invoice INSERT+two updates(3), charges(2),
        # stock movements(2), treatments including nonstock history(3).
        add(12, "audit_logs")
    elif profile.startswith("native_"):
        if profile not in ("native_pickup_annotation", "native_return_v1", "native_return_v2_discrepancy"):
            raise ValueError("Finite native schedule required")
        add(1, "clients", "pets", "clinical_recap_epochs", "billing_invoices", "native_prescriber_configurations",
            "native_prescription_drafts", "native_prescription_draft_revisions", "native_prescription_authorizations",
            "native_fill_slots", "native_dispenses", "native_dispense_allocations", "billing_invoice_items",
            "inventory_movements", "stock_movement_sources", "native_fulfillment_events")
        add(3, "native_prescription_operations")
        add(1, "native_fulfillment_operations", "controlled_stock_containers", "controlled_stock_container_heads", "controlled_stock_cells", "controlled_stock_positions")
        # Source native_rx_audit and inventory_audit triggers: domain birth(3),
        # configure/draft/sign(8), dispense native rows(5)+charge/movement/invoice(3).
        add(19, "audit_logs")
        if profile == "native_pickup_annotation":
            add(1, "native_pickups", "native_fulfillment_operations", "stock_pickup_sources",
                "native_dispense_correction_events", "native_dispense_correction_operations", "stock_correction_sources")
            add(4, "audit_logs")
        else:
            add(1, "native_return_events", "native_return_operations", "stock_custody_sources",
                "controlled_stock_containers", "controlled_stock_container_heads", "controlled_stock_cells", "controlled_stock_positions")
            add(2, "audit_logs")
            if profile == "native_return_v2_discrepancy":
                add(1, "native_return_discrepancy_events", "native_return_discrepancy_operations", "stock_discrepancy_sources")
                add(2, "audit_logs")
    elif profile in ("ordinary_none", "independent_witness", "variance_reconciliation"):
        add(1, "inventory_movements", "stock_movement_sources", "audit_logs", "controlled_stock_source_links",
            "controlled_stock_actions", "controlled_stock_events", "controlled_stock_event_lines", "controlled_stock_container_transitions")
        add(2 if profile == "ordinary_none" else 1, "controlled_stock_preparations")
        if profile == "ordinary_none":
            add(1, "controlled_stock_cancellations")
        if profile == "independent_witness":
            add(1, "controlled_stock_policy_versions", "controlled_stock_policy_sites", "controlled_stock_state_events")
        result.pop("public.stock_writer_admissions")
    elif profile != "commission_all" and profile not in ("count_agreement", "browser_lost_finalize"):
        raise ValueError("Finite prospective profile required")

    writers = {"scalars": (2, 2, 2), "clinical": (2, 2, 2),
               "native_pickup_annotation": (3, 3, 3), "native_return_v1": (2, 4, 3),
               "native_return_v2_discrepancy": (3, 4, 3)}
    if profile in writers:
        events, lines, transitions = writers[profile]
        add(events, "controlled_stock_preparations", "controlled_stock_actions", "controlled_stock_events", "controlled_stock_source_links")
        add(lines, "controlled_stock_event_lines")
        add(transitions, "controlled_stock_container_transitions")
        # The process-local admission cache cardinality is separately validated
        # against actual source-owned writer requests, not fixed to pool size.
        result.pop("public.stock_writer_admissions")
    return result
