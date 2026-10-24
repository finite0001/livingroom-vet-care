"""Finite AST invariants for reviewed calendar bodies; never SQL execution.

This is a targeted structural check, not a proof for arbitrary rewritten programs.
Comments/whitespace are ignored by PostgreSQL parsers; semantic shortcuts must
retain the specified AST and actual PL/pgSQL guard locations, not matching text.
"""
import json,re
from pglast import parse_plpgsql,parser


def walk(value):
    if isinstance(value,dict):
        yield value
        for child in value.values():yield from walk(child)
    elif isinstance(value,list):
        for child in value:yield from walk(child)


def normalize(value):
    if isinstance(value,dict):return {k:normalize(v)for k,v in value.items()if k not in {'location','stmt_location','stmt_len','lineno','version'}}
    if isinstance(value,list):return [normalize(v)for v in value]
    return value


def sql(query):return normalize(json.loads(parser.parse_sql_json(query)))

def expression(query):
    doc=sql('select '+query)
    return doc['stmts'][0]['stmt']['SelectStmt']['targetList'][0]['ResTarget']['val']


def parsed_expr(entry):
    query,mode=entry['query'],entry['parseMode']
    if mode==2:query='select '+query
    elif mode in(3,4,5):
        m=re.fullmatch(r'\s*[a-zA-Z_]\w*\s*(?::=|=)\s*(.*)',query,re.S)
        assert m,'Unknown assignment form';query='select '+m[1]
    else:assert mode==0,'Unknown PL/pgSQL expression mode'
    return sql(query)


def calls(tree,name):
    return [node['FuncCall']for node in walk(tree)if 'FuncCall'in node and [x['String']['sval']for x in node['FuncCall']['funcname']][-1]==name]


def select_ast(query):return sql(query)['stmts'][0]['stmt']['SelectStmt']


def same(actual,wanted,message):assert actual==wanted,message


def guard(statement,condition,message):
    node=statement.get('PLpgSQL_stmt_if');assert node,'Guard must be direct executable IF'
    same(parsed_expr(node['cond']['PLpgSQL_expr']),sql('select '+condition),'Guard condition changed')
    assert not node.get('else_body')and not node.get('elsif_list'),'Unexpected alternate guard path'
    wanted={'PLpgSQL_stmt_raise':{'elog_level':21,'message':message,'options':[{'PLpgSQL_raise_option':{'opt_type':0,'expr':{'PLpgSQL_expr':{'query':"'23514'",'parseMode':2}}}}]}}
    # Compare semantic parsed SQLSTATE expression separately from raw query text.
    body=normalize(node['then_body']);assert len(body)==1 and 'PLpgSQL_stmt_raise'in body[0]
    raise_=body[0]['PLpgSQL_stmt_raise'];assert raise_['elog_level']==21 and raise_['message']==message
    options=raise_['options'];assert len(options)==1 and options[0]['PLpgSQL_raise_option']['opt_type']==0
    same(parsed_expr(options[0]['PLpgSQL_raise_option']['expr']['PLpgSQL_expr']),sql("select '23514'"),'Guard SQLSTATE changed')


def audit(text):
    pattern=r'^-- BEGIN FUNCTION ([a-z_]+)\|jsonb\|plpgsql\n(.*?)^-- END FUNCTION$'
    matches=list(re.finditer(pattern,text,re.M|re.S));assert [m[1]for m in matches]==['calendar_candidates','resolve_calendar']
    functions={}
    for match,arg in zip(matches,('p_request','p_calendar')):
        functions[match[1]]=parse_plpgsql('create function audit('+arg+' jsonb)returns jsonb language plpgsql as $body$'+match[2]+'$body$;')[0]['PLpgSQL_function']
    trees={name:[parsed_expr(n['PLpgSQL_expr'])for n in walk(f)if 'PLpgSQL_expr'in n]for name,f in functions.items()}
    candidate,resolve=trees['calendar_candidates'],trees['resolve_calendar']
    series=[x for tree in candidate for x in calls(tree,'generate_series')];assert len(series)==1,'Exactly one exhaustive series'
    same(series[0]['args'],[expression('-50400'),expression('50400')],'Inclusive integral second endpoints/default step required')
    assert sum(len(calls(t,'timezone'))for t in candidate)==4,'No extra/reduced timezone conversion pass'
    assert sum(len(calls(t,'timezone'))for t in resolve)==1,'Only UTC wire-format conversion in resolver'
    assert sum(len(calls(t,'calendar_candidates'))for t in resolve)==1,'Resolve candidates exactly once'
    # Find the actual SQL statement containing the unique series, not a comment.
    tree=next(t for t in candidate if calls(t,'generate_series'));stmt=tree['stmts'][0]['stmt']['SelectStmt']
    ctes=stmt['withClause']['ctes'];assert len(ctes)==3
    byname={x['CommonTableExpr']['ctename']:x['CommonTableExpr']for x in ctes};assert set(byname)=={'local_inputs','matches','grouped'}
    source=byname['local_inputs'];assert source['ctematerialized']=='CTEMaterializeAlways'
    same(source['ctequery']['SelectStmt'],select_ast("select value as label,value::timestamp as local_value from jsonb_array_elements_text(p_request->'local_values')"),'Complete requested labels required')
    matched=byname['matches'];assert matched['ctematerialized']=='CTEMaterializeAlways'
    # AST proof of every integral offset and exact two-step zone round-trip.
    same(matched['ctequery']['SelectStmt'],select_ast("select l.label,o.offset_seconds,(l.local_value-o.offset_seconds*interval '1 second')at time zone 'UTC' as candidate from local_inputs l cross join generate_series(-50400,50400)as o(offset_seconds) where (((l.local_value-o.offset_seconds*interval '1 second')at time zone 'UTC')at time zone zone_name)=l.local_value"),'Enumeration/roundtrip relation changed')
    grouped=byname['grouped']['ctequery']['SelectStmt']
    same(grouped,select_ast("select l.label,coalesce((select jsonb_agg(jsonb_build_object('utc',to_char(m.candidate at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'offset_seconds',m.offset_seconds)order by m.candidate)from matches m where m.label=l.label),'[]'::jsonb)as candidates from local_inputs l"),'Complete unsliced candidate aggregation required')
    wanted_outer=select_ast("select jsonb_agg(jsonb_build_object('local_timestamp',label,'candidates',candidates)order by label collate \"C\") from grouped")
    same({k:v for k,v in stmt.items()if k!='withClause'},wanted_outer,'Complete unsliced outer result required')
    aggregate=[x for x in calls(grouped,'jsonb_agg')];assert len(aggregate)==1
    same(aggregate[0],calls(expression("jsonb_agg(jsonb_build_object('utc',to_char(m.candidate at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'offset_seconds',m.offset_seconds)order by m.candidate)"),'jsonb_agg')[0],'Retain all candidates and ordered offsets')
    subselect=[n['SelectStmt']for n in walk(grouped)if 'SelectStmt'in n]
    assert len(subselect)==1
    same(subselect[0].get('whereClause'),expression('m.label=l.label'),'No candidate pruning')
    assert not any(k in subselect[0]for k in ('limitCount','limitOffset','distinctClause','havingClause')),'No first-candidate truncation'
    for node in walk(stmt):
        if 'FuncCall'in node:assert not node['FuncCall'].get('agg_filter'),'No aggregate candidate filtering'
    # Complete returned result and unchanged supplied calendar are authoritative.
    candidate_body=functions['calendar_candidates']['action']['PLpgSQL_stmt_block']['body']
    resolve_body=functions['resolve_calendar']['action']['PLpgSQL_stmt_block']['body']
    returns=[n['PLpgSQL_stmt_return']for n in candidate_body if 'PLpgSQL_stmt_return'in n];assert len(returns)==1
    same(parsed_expr(returns[0]['expr']['PLpgSQL_expr']),sql('select result'),'No result candidate slicing')
    returns=[n['PLpgSQL_stmt_return']for n in resolve_body if 'PLpgSQL_stmt_return'in n];assert len(returns)==1
    same(parsed_expr(returns[0]['expr']['PLpgSQL_expr']),sql("select jsonb_build_object('calendar',p_calendar,'observation',jsonb_build_object('zone',p_calendar->'zone','postgres_version',server_version,'local_values',resolution))"),'No rewritten body/observation')
    loops=[n['PLpgSQL_stmt_fors']for n in resolve_body if 'PLpgSQL_stmt_fors'in n];assert len(loops)==2
    final=loops[1]['body'];midnight=[n for n in final if 'PLpgSQL_stmt_if'in n and any(v.get('message')=='calendar_unsupported_midnight'for v in walk(n))];assert len(midnight)==2
    for node in midnight:guard(node,'jsonb_array_length(boundaries)not between 1 and 2','calendar_unsupported_midnight')
    staffed=[n['PLpgSQL_stmt_if']for n in final if 'PLpgSQL_stmt_if'in n and parsed_expr(n['PLpgSQL_stmt_if']['cond']['PLpgSQL_expr'])==sql("select (day_row->>'staffed')::boolean")];assert len(staffed)==1
    closeguards=[n for n in staffed[0]['then_body']if 'PLpgSQL_stmt_if'in n and any(v.get('message')=='calendar_unsupported_close'for v in walk(n))];assert len(closeguards)==1
    guard(closeguards[0],'candidate_count not between 1 and 2 or fold>=candidate_count','calendar_unsupported_close')
    # No default-zone fallback in assignments or declaration defaults.
    assignments=[n['PLpgSQL_stmt_assign']for n in walk(functions['calendar_candidates'])if 'PLpgSQL_stmt_assign'in n]
    zone=[n for n in assignments if n['expr']['PLpgSQL_expr']['query'].lstrip().startswith('zone_name')];assert len(zone)==1
    same(parsed_expr(zone[0]['expr']['PLpgSQL_expr']),sql("select p_request->>'zone'"),'Zone must come from exact validated input')
    for datum in functions['calendar_candidates']['datums']:
        var=datum.get('PLpgSQL_var',{})
        if var.get('refname')=='zone_name':assert 'default_val'not in var,'No default zone'
    return {'functions':2,'parsed_expressions':sum(map(len,trees.values())),'rules':['integral_offset_enumeration','complete_ordered_candidates','exact_zone_roundtrip','no_default_zone','single_resolution_pass','executable_two_candidate_guards','unchanged_return_payload'],'database_executed':False}
