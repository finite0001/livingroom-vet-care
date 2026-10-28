"""Prospective exact new-relation effects; not target-observed expectations."""
import full121_queries as sql
COUNT_TABLES=('policies','operations','cycles','snapshots','statements','outcomes','cancellations','causes','resolutions','open_causes','reconciliation_preparations','reconciliation_approvals','reconciliation_executions','reconciliation_confirmations','reconciliation_execution_causes','descriptor','operation_closures')
PARENT_TABLES=('controlled_stock_preparations','controlled_stock_actions','controlled_stock_events','controlled_stock_cancellations')

def source_counts():
 pieces=["'"+name+"',(select count(*)from controlled_count_v1."+name+")"for name in COUNT_TABLES]
 pieces.extend(["'journal',(select count(*)from controlled_stock_workflow_v1.journal)","'witness_operations',(select count(*)from controlled_stock_workflow_v1.witness_operations)"])
 pieces.extend("'"+name+"',(select count(*)from public."+name+")"for name in PARENT_TABLES)
 return sql.read('select jsonb_build_object('+','.join(pieces)+');')

def expected(profile,phase='complete'):
 if profile=='record_review_signing':return expected('ordinary_none',phase)
 if profile not in('commission_all','count_agreement','ordinary_none','independent_witness','variance_reconciliation','browser_lost_finalize'):raise ValueError('Finite profile only')
 out={key:0 for key in COUNT_TABLES+PARENT_TABLES};out.update(descriptor=1,journal=21,witness_operations=0)
 if profile in('count_agreement','variance_reconciliation','browser_lost_finalize'):out.update(policies=2,operation_closures=3)
 if profile in('count_agreement','browser_lost_finalize'):
  out.update(operations=4,cycles=1,snapshots=1,statements=2,outcomes=1,operation_closures=7)
  if profile=='count_agreement':out.update(operations=6,cycles=2,snapshots=2,cancellations=1,operation_closures=10)
  if profile=='browser_lost_finalize'and phase=='before_browser':out.update(operations=3,outcomes=0,operation_closures=6)
 elif profile=='ordinary_none':out.update(journal=25,controlled_stock_preparations=2,controlled_stock_actions=1,controlled_stock_events=1,controlled_stock_cancellations=1)
 elif profile=='independent_witness':out.update(journal=25,witness_operations=2,controlled_stock_preparations=1,controlled_stock_actions=1,controlled_stock_events=1)
 elif profile=='variance_reconciliation':out.update(operations=13,cycles=2,snapshots=2,statements=4,outcomes=2,causes=1,resolutions=1,reconciliation_preparations=1,reconciliation_approvals=1,reconciliation_executions=1,reconciliation_confirmations=1,reconciliation_execution_causes=1,operation_closures=16,controlled_stock_preparations=1,controlled_stock_actions=1,controlled_stock_events=1)
 return out

def verify(query,label,profile,phase='complete'):
 actual=query(label,source_counts());want=expected(profile,phase)
 if actual!=want:raise ValueError('Committed exact count/workflow/parent relation counts differ from source profile')
 return actual
