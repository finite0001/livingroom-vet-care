"""Fixed read-only owner DATA factories. Owner30; no actor claims/business writes."""
from full121_values import uid
READ="begin read only;set local timezone='UTC';set local datestyle='ISO,YMD';set local intervalstyle='postgres';set local extra_float_digits=3;set local statement_timeout='30s';set local lock_timeout='5s';\n"
def read(sql):return READ+sql+'\nrollback;\n'
def clock():return read("select jsonb_build_object('at',to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'date',(clock_timestamp()at time zone'UTC')::date::text,'expiry',((clock_timestamp()at time zone'UTC')::date+365)::text);")
def opening(product,site):
 product=uid(product);site=uid(site)
 return read(f"""select jsonb_build_object('containers',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'opening_id',c.opening_id,'stock_lot_id',c.stock_lot_id)order by c.id),'[]'::jsonb)from public.controlled_stock_containers c where c.product_id='{product}'::uuid and c.controlling_site_id='{site}'::uuid),
 'cells',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'container_id',c.container_id,'lot_id',c.lot_id,'channel',c.channel)order by c.id),'[]'::jsonb)from public.controlled_stock_cells c join public.controlled_stock_containers x on x.id=c.container_id where x.product_id='{product}'::uuid and x.controlling_site_id='{site}'::uuid),
 'positions',(select coalesce(jsonb_agg(jsonb_build_object('cell_id',p.cell_id,'quantity',p.quantity::text)order by p.cell_id),'[]'::jsonb)from public.controlled_stock_positions p join public.controlled_stock_cells c on c.id=p.cell_id join public.controlled_stock_containers x on x.id=c.container_id where x.product_id='{product}'::uuid and x.controlling_site_id='{site}'::uuid));""")
def journal(operations):
 ids=','.join("'"+uid(x)+"'::uuid"for x in operations)
 if not ids:raise ValueError('Finite source operation set required')
 return read(f"select coalesce(jsonb_agg(jsonb_build_object('operation_id',j.operation_id,'stage',j.stage,'protocol',j.protocol,'action',j.action,'actor_id',j.actor_id,'session_id',j.session_id)order by j.operation_id,j.stage),'[]'::jsonb)from controlled_stock_workflow_v1.journal j where j.operation_id in({ids});")
