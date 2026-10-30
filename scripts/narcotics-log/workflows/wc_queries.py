"""Fixed owner30 read-only row diagnostics; no caller-selected SQL or claims."""
import full121_values as v
import full121_queries as sql

def stock(product):
 p=v.uid(product)
 return sql.read(f"""select jsonb_build_object(
 'cells',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'container_id',c.container_id,'lot_id',c.lot_id,'channel',c.channel,'dispense_id',c.dispense_id,'allocation_id',c.allocation_id,'intake_id',c.intake_id,'quantity',p.quantity::text)order by c.id),'[]'::jsonb)from public.controlled_stock_cells c join public.controlled_stock_positions p on p.cell_id=c.id join public.controlled_stock_containers x on x.id=c.container_id where x.product_id='{p}'::uuid),
 'heads',(select coalesce(jsonb_agg(jsonb_build_object('container_id',h.container_id,'version',h.version,'status',h.status,'location_id',h.location_id,'custodian_id',h.custodian_id)order by h.container_id),'[]'::jsonb)from public.controlled_stock_container_heads h join public.controlled_stock_containers c on c.id=h.container_id where c.product_id='{p}'::uuid),
 'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'writer',e.writer,'kind',e.event_kind,'actor',e.actor_id,'session',e.session_id)order by e.id),'[]'::jsonb)from public.controlled_stock_events e where e.product_id='{p}'::uuid),
 'lines',(select count(*)from public.controlled_stock_event_lines l join public.controlled_stock_events e on e.id=l.event_id where e.product_id='{p}'::uuid),
 'transitions',(select count(*)from public.controlled_stock_container_transitions t join public.controlled_stock_events e on e.id=t.event_id where e.product_id='{p}'::uuid));""")

def clinical(domain):
 pet=v.uid(domain['pet']);inv=v.uid(domain['invoice']);an=v.uid(domain['anesthesia'])
 return sql.read(f"""select jsonb_build_object(
 'treatments',(select coalesce(jsonb_agg(to_jsonb(t)order by t.id),'[]'::jsonb)from public.patient_treatments t where pet_id='{pet}'::uuid),
 'invoice',(select to_jsonb(i)from public.billing_invoices i where id='{inv}'::uuid),
 'revision_rows',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)from public.anesthesia_record_revisions v where record_id='{an}'::uuid),
 'anesthesia',(select to_jsonb(r)from public.patient_anesthesia_records r where id='{an}'::uuid));""")

def lot(lot_id):
 identifier=v.uid(lot_id)
 return sql.read(f"select to_jsonb(l)from public.inventory_lots l where id='{identifier}'::uuid;")
