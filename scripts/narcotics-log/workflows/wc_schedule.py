"""Finite source schedules for the framework, not observations or authority."""
import wc_profiles as profiles
import wc_gateway as gateway
import wc_domain as domain
import full121_commissioning as commissioning
MODULE_LOAD_ORDER=('wc_clinical_values','wc_native_values','wc_annotation_values','wc_return1_values','wc_return2_values','wc_discrepancy_values','wc_gateway','wc_domain','wc_queries','wc_profiles','wc_schedule')
# Final receipt capture stages are source literals, one after each execute.
CAPTURES={
 'scalars':('writer-receive-posted-receipt','writer-adjust-posted-receipt'),
 'clinical':('writer-clinical-0-posted-receipt','writer-clinical-1-posted-receipt'),
 'native_pickup_annotation':('writer-dispense-posted-receipt','writer-pickup-posted-receipt','writer-annotation-posted-receipt'),
 'native_return_v1':('writer-dispense-posted-receipt','writer-intake-posted-receipt'),
 'native_return_v2_discrepancy':('writer-dispense-posted-receipt','writer-intake-posted-receipt','writer-discrepancy-posted-receipt')}
SUFFIX_QUERY_FACTORIES={
 'scalars':('wc_queries.lot','full121_queries.clock','wc_queries.stock','full121_effects.source_counts','full121_queries.journal'),
 'clinical':('full121_queries.clock','wc_queries.clinical','wc_queries.stock','full121_effects.source_counts','full121_queries.journal'),
 'native_pickup_annotation':('wc_domain.prescription:fixed Denver date SELECT','full121_queries.clock','wc_queries.stock','full121_effects.source_counts','full121_queries.journal'),
 'native_return_v1':('wc_domain.prescription:fixed Denver date SELECT','full121_queries.clock','wc_queries.stock','full121_effects.source_counts','full121_queries.journal'),
 'native_return_v2_discrepancy':('wc_domain.prescription:fixed Denver date SELECT','full121_queries.clock','wc_queries.stock','full121_effects.source_counts','full121_queries.journal')}
# Extra original domain rows (outside baseline API-only commissioning), from
# exact old API constructors and source branches. Original audit/sequence/
# complete table-multiset composition stays a framework source responsibility.
DOMAIN_COUNTS={
 'scalars':{'inventory_movements':2,'stock_movement_sources':2},
 'clinical':{'clients':1,'pets':1,'billing_invoices':1,'patient_anesthesia_records':1,'anesthesia_record_revisions':1,'patient_treatments':3,'billing_invoice_items':2,'inventory_movements':2,'stock_movement_sources':2},
 'native_pickup_annotation':{'clients':1,'pets':1,'billing_invoices':1,'native_prescription_drafts':1,'native_prescription_authorizations':1,'native_fill_slots':1,'native_dispenses':1,'native_dispense_allocations':1,'native_pickups':1,'native_dispense_correction_events':1,'billing_invoice_items':1,'inventory_movements':1,'stock_movement_sources':1},
 'native_return_v1':{'clients':1,'pets':1,'billing_invoices':1,'native_prescription_drafts':1,'native_prescription_authorizations':1,'native_fill_slots':1,'native_dispenses':1,'native_dispense_allocations':1,'native_return_events':1,'billing_invoice_items':1,'inventory_movements':1,'stock_movement_sources':1},
 'native_return_v2_discrepancy':{'clients':1,'pets':1,'billing_invoices':1,'native_prescription_drafts':1,'native_prescription_authorizations':1,'native_fill_slots':1,'native_dispenses':1,'native_dispense_allocations':1,'native_return_events':1,'native_return_discrepancy_events':1,'billing_invoice_items':1,'inventory_movements':1,'stock_movement_sources':1}}

def specification():
 allowed=sorted(set(commissioning.RPCS+gateway.RPCS+domain.RPCS+('record_patient_treatment',)))
 return dict(schema_version=1,profile_entries={p:'wc_profiles.'+p for p in profiles.PROFILE_WRITERS},load_order=list(MODULE_LOAD_ORDER),gateway_rpc_order=['probe_controlled_stock_intent_v1','prepare_managed_stock_intent_v1','read_managed_stock_intent_v1','execute_managed_stock_intent_v1','read_managed_stock_intent_v1','close_managed_stock_intent_v1'],rpc_allowlist=allowed,profiles={p:dict(auth_sessions=2,additional_auth_requests=0,commissioning_http=62,suffix_business_http=profiles.PROFILE_SUFFIX_HTTP[p],business_http=62+profiles.PROFILE_SUFFIX_HTTP[p],writer_order=list(profiles.PROFILE_WRITERS[p]),owner_PB50_capture_stages=list(CAPTURES[p]),owner_query_factories=list(SUFFIX_QUERY_FACTORIES[p]),extra_domain_counts=DOMAIN_COUNTS[p],full_original_effect_composition_admitted=False)for p in profiles.PROFILE_WRITERS},budgets=dict(total=600,work=540,cleanup=55,owner=30,app=8,lock=5),execution_admitted=False)
