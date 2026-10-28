"""Lossless source edits for private, single-invocation historical validation.

No database, runtime flag, stored certificate, or caller-supplied map is used.
The owning source root constructs the map only after complete validation.
"""
import re

CALL = re.compile(r'(?<![\w$])(?P<name>controlled_count_v1\.[a-z0-9_]+)\s*\(')
ARGUMENT = 'p_validated_documents'


def code_mask(text):
    if type(text) is not str or len(text) > 1048576:
        raise ValueError('Bounded original source body required')
    result = list(text)
    index = 0
    while index < len(text):
        start = index
        if text.startswith('--', index):
            end = text.find('\n', index)
            index = len(text) if end < 0 else end
        elif text.startswith('/*', index):
            index += 2
            depth = 1
            while depth:
                if index >= len(text):
                    raise ValueError('Unclosed source block comment')
                if text.startswith('/*', index):
                    depth += 1
                    index += 2
                elif text.startswith('*/', index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
        elif text[index] in ("'", '"'):
            quote = text[index]
            escapes = quote == "'" and index > 0 and text[index - 1] in 'eE' and (index < 2 or not (text[index - 2].isalnum() or text[index - 2] == '_'))
            index += 1
            while True:
                if index >= len(text):
                    raise ValueError('Unclosed source string or quoted identifier')
                if escapes and text[index] == '\\':
                    index += 2
                elif text[index] == quote:
                    index += 1
                    if index < len(text) and text[index] == quote:
                        index += 1
                    else:
                        break
                else:
                    index += 1
        elif text[index] == '$' and (delimiter := re.match(r'\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$', text[index:])):
            marker = delimiter[0]
            end = text.find(marker, index + len(marker))
            if end < 0:
                raise ValueError('Unclosed source dollar string')
            index = end + len(marker)
        else:
            index += 1
            continue
        result[start:index] = ' ' * (index - start)
    return ''.join(result)


def qualified_calls(body):
    return {match['name'] for match in CALL.finditer(code_mask(body))}


def retarget_calls(body, mapping, *, inverse=False, argument=ARGUMENT):
    if argument not in ('p_validated_documents','validated_documents'):
        raise ValueError('Only the declared private document-map identifier is allowed')
    mask = code_mask(body)
    edits = []
    calls = 0
    for match in CALL.finditer(mask):
        if match['name'] not in mapping:
            continue
        opening = match.end() - 1
        position = opening + 1
        depth = 1
        while depth and position < len(mask):
            if mask[position] == '(':
                depth += 1
            elif mask[position] == ')':
                depth -= 1
            position += 1
        if depth:
            raise ValueError('Unclosed original source call')
        closing = position - 1
        if inverse:
            suffix = ',' + argument
            if body[closing - len(suffix):closing] != suffix:
                raise ValueError('Exact private argument inverse required')
            edits.append((closing - len(suffix), closing, ''))
        else:
            if not body[opening + 1:closing].strip():
                raise ValueError('Only original nonzero-argument graph helpers are admitted')
            edits.append((closing, closing, ',' + argument))
        edits.append((match.start('name'), match.end('name'), mapping[match['name']]))
        calls += 1
    result = body
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    return result, calls


def inline_registry_receipt(parent_body, receipt_body):
    """Remove only three locally dominated pure receipt-input validations."""
    call="receipt_value:=controlled_count_v1.saved_public_receipt_values(action_name,request_value,result_value,p_registry->'receipt');"
    prior="action_value:=controlled_count_v1.saved_action_values(action_name);\n request_value:=controlled_count_v1.saved_original_request_values(action_name,p_registry->'canonical_request');\n result_value:=controlled_count_v1.result_header_values(action_value->>'result_kind',p_result);\n "
    removed=("action_value:=controlled_count_v1.saved_action_values(p_action);",
             "request_value:=controlled_count_v1.saved_original_request_values(p_action,p_original_request);",
             "result_value:=controlled_count_v1.result_header_values(action_value->>'result_kind',p_result);")
    if parent_body.count(prior+call)!=1 or parent_body.count(call)!=1:
        raise ValueError('Exact immediately dominating registry input checks required')
    mask=code_mask(receipt_body);begins=list(re.finditer(r'\bbegin\b',mask,re.I))
    declaration=r'\s*declare\s+action_value\s+jsonb\s*;\s*request_value\s+jsonb\s*;\s*result_value\s+jsonb\s*;\s*receipt_value\s+jsonb\s*;\s*'
    if len(begins)!=1 or re.fullmatch(declaration,mask[:begins[0].start()],re.I)is None:
        raise ValueError('Exact original public receipt locals required')
    terminal=re.search(r'\breturn\s+receipt_value\s*;\s*end\s*;?\s*$',mask,re.I)
    if terminal is None or len(re.findall(r'\breturn\b',mask,re.I))!=1:
        raise ValueError('Only the original terminal receipt return is allowed')
    remainder=receipt_body[begins[0].end():terminal.start()]
    # Check order and disallow any intervening executable statement. Comments
    # documenting the result-header boundary remain in the nested block.
    positions=[]
    for statement in removed:
        if remainder.count(statement)!=1:raise ValueError('Exact duplicate receipt input validator required')
        positions.append(remainder.index(statement))
    if positions!=sorted(positions):raise ValueError('Original receipt validation order required')
    prefix=remainder[:positions[-1]+len(removed[-1])]
    for statement in removed:prefix=prefix.replace(statement,'',1)
    if code_mask(prefix).strip():raise ValueError('No executable statements before the receipt checks may be removed')
    for statement in removed:
        remainder=re.sub(r'(?m)^[ \t]*'+re.escape(statement)+r'[ \t]*\n','',remainder,count=1)
        if statement in remainder:raise ValueError('Whole duplicate-validator line required')
    replacements={'receipt_value':'inline_receipt','p_action':'action_name','p_receipt':"(p_registry->'receipt')"}
    tokens=list(re.finditer(r'\b(receipt_value|p_action|p_receipt)\b',code_mask(remainder)))
    changed=remainder
    for token in reversed(tokens):changed=changed[:token.start()]+replacements[token[0]]+changed[token.end():]
    restored=changed;offset=0;inverse_tokens=[]
    for token in tokens:
        start=token.start()+offset;end=start+len(replacements[token[0]])
        if changed[start:end]!=replacements[token[0]]:raise ValueError('Exact receipt identifier span required')
        inverse_tokens.append((start,end,token[0]));offset+=len(replacements[token[0]])-len(token[0])
    for start,end,original in reversed(inverse_tokens):restored=restored[:start]+original+restored[end:]
    if restored!=remainder:raise ValueError('Complete receipt identifier inverse required')
    if re.search(r'\b(p_action|p_original_request|p_result|p_receipt|return)\b',code_mask(changed),re.I):
        raise ValueError('No unbound receipt input or caller exit allowed')
    inline='DECLARE inline_receipt jsonb;BEGIN'+changed+'receipt_value:=inline_receipt;END;'
    after=parent_body.replace(call,inline,1)
    if after.count(inline)!=1 or after.replace(inline,call,1)!=parent_body:
        raise ValueError('Whole registry body inverse required')
    sha=lambda value:__import__('hashlib').sha256(value.encode()).hexdigest()
    return after,call,inline,dict(original_receipt_body_sha256=sha(receipt_body),
        removed_duplicate_validators_sha256=sha('\n'.join(removed)),inline_sha256=sha(inline),
        complete_identifier_substitution_inverse=True,whole_registry_clone_inverse=True)


def inline_parent_cell(parent_body, cell_body):
    """Inline only the pure cell remainder after the same boundary was checked."""
    prior="perform controlled_count_v1.history_scan_historical_parent_preparation_boundary_values(parent_prep,b->'boundary',p_validated_documents);"
    call="perform controlled_count_v1.history_scan_historical_parent_preparation_cell_values(parent_prep,b->'boundary',cell_value,p_validated_documents);"
    duplicate='perform controlled_count_v1.historical_parent_preparation_boundary_values(p_preparation,p_boundary);'
    if parent_body.count(prior)!=1 or parent_body.count(call)!=1 or cell_body.count(duplicate)!=1:
        raise ValueError('Exact dominating boundary and original cell helper calls required')
    start=parent_body.index(prior)+len(prior);end=parent_body.index(call)
    span=code_mask(parent_body[start:end])
    if start>end or re.search(r'\b(parent_prep|b)\s*:=|\b(insert|update|delete|truncate|execute|call)\b',span,re.I):
        raise ValueError('Unchanged parent/boundary and write-free dominance required')
    masked=code_mask(cell_body)
    begins=list(re.finditer(r'\bbegin\b',masked,re.I))
    if len(begins)!=1 or re.fullmatch(r'\s*declare\s+actual_cells\s+uuid\s*\[\s*\]\s*;\s*',masked[:begins[0].start()],re.I)is None:
        raise ValueError('Exact cell-helper local declaration required')
    if cell_body[begins[0].end():cell_body.index(duplicate)].strip()or re.search(r'\breturn\b',masked,re.I):
        raise ValueError('First boundary call and implicit void return required')
    remainder=re.sub(r'(?m)^[ \t]*'+re.escape(duplicate)+r'[ \t]*\n','',cell_body,count=1)
    if duplicate in remainder:remainder=cell_body.replace(duplicate,'',1)
    if qualified_calls(remainder)!={'controlled_count_v1.historical_rows_controlled_stock_cells'}:
        raise ValueError('Only the exact pure JSON/UUID cell remainder may be inlined')
    # Change code identifiers only. Quoted JSON keys, the original error and
    # every filtering/cardinality predicate remain byte-identical.
    substitutions={'p_preparation':'parent_prep','p_boundary':"(b->'boundary')",'p_cause_cell':'cell_value'}
    result=remainder
    tokens=list(re.finditer(r'\b(p_preparation|p_boundary|p_cause_cell)\b',code_mask(remainder)))
    for match in reversed(tokens):
        result=result[:match.start()]+substitutions[match[0]]+result[match.end():]
    positions=[];shift=0
    for match in tokens:
        start=match.start()+shift;end=start+len(substitutions[match[0]])
        if result[start:end]!=substitutions[match[0]]:
            raise ValueError('Identifier replacement moved outside its exact source token')
        positions.append((start,end,match[0]));shift+=len(substitutions[match[0]])-len(match[0])
    restored=result
    for start,end,original in reversed(positions):restored=restored[:start]+original+restored[end:]
    if restored!=remainder:raise ValueError('Whole cell-helper identifier substitution inverse required')
    result=result.lstrip('\n')
    # A function's outermost END may omit its semicolon; a nested block may
    # not. Retain every source byte and add only that enclosing delimiter.
    delimiter_added=not code_mask(result).rstrip().endswith(';')
    if delimiter_added:result+=';'
    after=parent_body.replace(call,result,1)
    if after.count(result)!=1 or after.replace(result,call,1)!=parent_body:
        raise ValueError('Whole original management clone inverse required')
    digest=lambda text:__import__('hashlib').sha256(text.encode()).hexdigest()
    return after,call,result,dict(original_cell_body_sha256=digest(cell_body),
        exact_cell_remainder_sha256=digest(remainder),dominating_span_sha256=digest(parent_body[start:end]),
        original_full_boundary_call_retained=True,all_original_cell_predicates_retained=True,
        nested_block_delimiter_added=delimiter_added,
        complete_identifier_substitution_inverse=True,
        helper_configuration_independent_JSON_and_UUID_only=True,whole_management_clone_inverse=True)


POLICY_REUSE_BLOCK = '''
 -- Pure document grammar only: full chains and current authority remain fresh.
 -- Every entry was validated before it entered this invocation-local map.
 if jsonb_typeof(p_validated_documents)<>'object'then
  perform 1 from jsonb_each(p_validated_documents);
 end if;
 if exists(
  select 1 from controlled_count_v1.policies policy_row
  where policy_row.policy_id::text=p_document->>'policy_id'
   and(p_validated_documents->('policy_values:'||policy_row.policy_id::text))::text is not distinct from policy_row.document::text
   and policy_row.document::text is not distinct from p_document::text
   and p_document->'policy_id'=to_jsonb(policy_row.policy_id)
   and p_document->'product_id'=to_jsonb(policy_row.product_id)and p_document->'site_id'=to_jsonb(policy_row.site_id)
   and p_document->>'record_hash'=policy_row.record_hash
   and controlled_count_v1.document_hash(p_document)=policy_row.record_hash
  union all
  select 1 from jsonb_object_keys(p_validated_documents)verified(key)
  join controlled_count_v1.snapshots snapshot_row on verified.key='snapshot:'||snapshot_row.snapshot_id::text
  join controlled_count_v1.policies policy_row on(p_validated_documents->verified.key)#>'{policy,policy_id}'=to_jsonb(policy_row.policy_id)
  where(p_validated_documents->verified.key)::text is not distinct from snapshot_row.document::text
   and(p_validated_documents->verified.key)->'id'=to_jsonb(snapshot_row.snapshot_id)
   and(p_validated_documents->verified.key)->>'record_hash'=snapshot_row.record_hash
   and controlled_count_v1.document_hash(p_validated_documents->verified.key)=snapshot_row.record_hash
   and((p_validated_documents->verified.key)->'policy')::text is not distinct from policy_row.document::text
   and((p_validated_documents->verified.key)->'policy')::text is not distinct from p_document::text
   and p_document->'policy_id'=to_jsonb(policy_row.policy_id)
   and p_document->'product_id'=to_jsonb(policy_row.product_id)and p_document->'site_id'=to_jsonb(policy_row.site_id)
   and p_document->>'record_hash'=policy_row.record_hash
   and controlled_count_v1.document_hash(p_document)=policy_row.record_hash
 )then return p_document;end if;
'''

ROOT_POLICY_BEFORE = "  if document_value is null then raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;"
ROOT_POLICY_AFTER = ROOT_POLICY_BEFORE + '''
  -- The ORIGINAL complete chain has just validated every selected policy.
  -- Store only its immutable full documents for pure grammar reuse.
  for policy_row in select p.*from controlled_count_v1.policies p
   where p.product_id=p_product and p.site_id=item.site_id order by p.version loop
   if policy_row.document->'policy_id'is distinct from to_jsonb(policy_row.policy_id)
   or policy_row.document->'product_id'is distinct from to_jsonb(policy_row.product_id)
   or policy_row.document->'site_id'is distinct from to_jsonb(policy_row.site_id)
   or policy_row.document->>'record_hash'is distinct from policy_row.record_hash
   or controlled_count_v1.document_hash(policy_row.document)is distinct from policy_row.record_hash then
    raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
   memo_key:='policy_values:'||policy_row.policy_id::text;
   if octet_length(validated_documents::text)+octet_length(policy_row.document::text)+octet_length(memo_key)+8<=16777216 then
    validated_documents:=validated_documents||jsonb_build_object(memo_key,policy_row.document);
   end if;
  end loop;'''


REUSE_BLOCK = '''
 -- Reuse only a document fully validated by an EARLIER completed registry
 -- root in THIS invocation. This map never comes from a public request.
 if p_validated_documents ? (p_kind||':'||p_id::text)then
  declare verified_document jsonb:=p_validated_documents->(p_kind||':'||p_id::text);observed_document jsonb;
  begin
   observed_document:=(controlled_count_v1.readcore_saved_result_row(p_kind,p_id))->'document';
   if jsonb_typeof(verified_document)is distinct from 'object'
   or verified_document->'id'is distinct from to_jsonb(p_id)
   or verified_document::text is distinct from observed_document::text
   or verified_document->>'record_hash'is distinct from controlled_count_v1.document_hash(verified_document)then
    raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
   return verified_document;
  end;
 end if;
'''

SNAPSHOT_REUSE_BLOCK = '''
 if p_validated_documents ? ('snapshot:'||p_id::text)then
  declare verified_snapshot_document jsonb:=p_validated_documents->('snapshot:'||p_id::text);observed_snapshot_document jsonb;observed_snapshot_row jsonb;
  begin
   select to_jsonb(s)into strict observed_snapshot_row from controlled_count_v1.snapshots s where s.snapshot_id=p_id;
   observed_snapshot_document:=observed_snapshot_row->'document';
   if jsonb_typeof(verified_snapshot_document)is distinct from 'object'
   or verified_snapshot_document->'id'is distinct from to_jsonb(p_id)
   or verified_snapshot_document::text is distinct from observed_snapshot_document::text
   or verified_snapshot_document->'record_hash'is distinct from observed_snapshot_row->'record_hash'
   or verified_snapshot_document->>'record_hash'is distinct from controlled_count_v1.document_hash(verified_snapshot_document)then
    raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
   return verified_snapshot_document;
  end;
 end if;
'''

BOUNDARY_VALIDATION_BEFORE = ' perform controlled_count_v1.historical_boundary_values(p_boundary);'
BOUNDARY_VALIDATION_AFTER = ''' -- Only earlier completed graph roots can supply these original documents.
 -- Both branches reread the actual immutable source row and bind exact bytes.
 if not exists(
  select 1 from jsonb_each(p_validated_documents)verified
  join controlled_count_v1.snapshots snapshot_row on verified.key='snapshot:'||snapshot_row.snapshot_id::text
  where verified.value::text is not distinct from snapshot_row.document::text
   and verified.value->'id'=to_jsonb(snapshot_row.snapshot_id)
   and verified.value->>'record_hash'=snapshot_row.record_hash
   and controlled_count_v1.document_hash(verified.value)=snapshot_row.record_hash
   and(verified.value->'physical_boundary')::text is not distinct from p_boundary::text
  union all
  select 1 from jsonb_each(p_validated_documents)verified
  join controlled_count_v1.outcomes outcome_row on verified.key='outcome:'||outcome_row.outcome_id::text
  where verified.value::text is not distinct from outcome_row.document::text
   and verified.value->'id'=to_jsonb(outcome_row.outcome_id)
   and verified.value->>'record_hash'=outcome_row.record_hash
   and controlled_count_v1.document_hash(verified.value)=outcome_row.record_hash
   and(verified.value#>'{body,boundary_observation,boundary}')::text is not distinct from p_boundary::text
 )then
  perform controlled_count_v1.historical_boundary_values(p_boundary);
 end if;'''
BOUNDARY_REUSE_BLOCK = BOUNDARY_VALIDATION_AFTER.replace('if not exists(', 'if exists(', 1).replace(
    '  perform controlled_count_v1.historical_boundary_values(p_boundary);', '  return;', 1)

ROOT_CALL_BEFORE = '  perform controlled_count_v1.readcore_validate_operation_graph(item.operation_id);'
ROOT_CALL_AFTER = '''  perform controlled_count_v1.history_scan_validate_operation_graph(item.operation_id,validated_documents);
  -- Only a COMPLETED whole operation/result/registry/closure validation adds
  -- an entry. No in-progress recursion or unverifiable result is remembered.
  select to_jsonb(o)into strict operation_row from controlled_count_v1.operations o where o.operation_id=item.operation_id;
  if operation_row->>'result_kind'=any(array['cycle','statement','outcome','cancellation','reconciliation_preparation','reconciliation_approval','reconciliation_execution','reconciliation_confirmation','cause_resolution'])then
   document_value:=(controlled_count_v1.readcore_saved_result_row(operation_row->>'result_kind',(operation_row->>'result_id')::uuid))->'document';
   memo_key:=(operation_row->>'result_kind')||':'||(operation_row->>'result_id');
   -- Capacity affects reuse only. When full, ordinary complete validation
   -- continues; the retained history is never truncated or rejected for it.
   if octet_length(validated_documents::text)+octet_length(document_value::text)+octet_length(memo_key)+8<=16777216 then
    validated_documents:=validated_documents||jsonb_build_object(memo_key,document_value);
   end if;
   if operation_row->>'result_kind'='cycle'then
    -- The completed cycle graph also fully validated this exact snapshot.
    select to_jsonb(s)into strict retained_snapshot_row from controlled_count_v1.snapshots s
     where s.snapshot_id=(document_value#>>'{body,snapshot_id}')::uuid;
    retained_snapshot_document:=retained_snapshot_row->'document';
    if retained_snapshot_document->'id'is distinct from document_value#>'{body,snapshot_id}'
    or retained_snapshot_document->'record_hash'is distinct from document_value#>'{body,snapshot_hash}'
    or retained_snapshot_document->'record_hash'is distinct from retained_snapshot_row->'record_hash'
    or controlled_count_v1.document_hash(retained_snapshot_document)is distinct from document_value#>>'{body,snapshot_hash}'then
     raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
    memo_key:='snapshot:'||(retained_snapshot_document->>'id');
    if octet_length(validated_documents::text)+octet_length(retained_snapshot_document::text)+octet_length(memo_key)+8<=16777216 then
     validated_documents:=validated_documents||jsonb_build_object(memo_key,retained_snapshot_document);
    end if;
   end if;
  end if;'''

ROOT_EDITS = (
    ('declare item record;document_value jsonb;', "declare item record;document_value jsonb;validated_documents jsonb:='{}'::jsonb;operation_row jsonb;memo_key text;retained_snapshot_document jsonb;retained_snapshot_row jsonb;policy_row record;"),
    (ROOT_POLICY_BEFORE,ROOT_POLICY_AFTER),
    (' order by o.operation_id loop', ''' order by case o.result_kind when 'policy'then 0 when 'cycle'then 1 when 'statement'then 2 when 'outcome'then 3 when 'cancellation'then 3
 when 'reconciliation_preparation'then 4 when 'reconciliation_approval'then 5 when 'reconciliation_execution'then 6 when 'reconciliation_confirmation'then 7 when 'cause_resolution'then 8 else 99 end,o.operation_id loop'''),
    (ROOT_CALL_BEFORE, ROOT_CALL_AFTER),
)

PREPARATION_ENTRY = '''
 if p_kind='reconciliation_preparation'then
  return controlled_count_v1.history_preparation_graph(p_id);
 end if;
 if p_kind='reconciliation_approval'then
  return controlled_count_v1.history_approval_graph(p_id);
 end if;
 if p_kind='reconciliation_execution'then
  return controlled_count_v1.history_execution_graph(p_id);
 end if;
 if p_kind='cause_resolution'then
  return controlled_count_v1.history_resolution_graph(p_id);
 end if;
'''

# The ordinary graph retains its original complete frontier assertion before
# entering the same source-private historical preparation root.
ORDINARY_PREPARATION_ENTRY = PREPARATION_ENTRY

PREPARATION_GRAPH_SQL = '''CREATE FUNCTION controlled_count_v1.history_preparation_graph(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,controlled_count_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
DECLARE preparation_row jsonb;source_row record;validated_documents jsonb:='{}';registry_row jsonb;
 cycle_row jsonb;cycle_document jsonb;snapshot_row jsonb;snapshot_document jsonb;outcome_row jsonb;document_value jsonb;memo_key text;
BEGIN
 PERFORM controlled_count_entry_v1.resource_origin_catalog_required();
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 SELECT to_jsonb(p)INTO STRICT preparation_row FROM controlled_count_v1.reconciliation_preparations p WHERE p.preparation_id=p_id;
 -- Hints select ancestors only; they never certify a result. Unsupported or
 -- malformed projections use the complete original validation path below.
 IF jsonb_typeof(preparation_row#>'{document,body,live_causes}')IS DISTINCT FROM'array'THEN
  RETURN controlled_count_v1.history_scan_saved_result_graph('reconciliation_preparation',p_id,validated_documents);
 END IF;
 IF jsonb_array_length(preparation_row#>'{document,body,live_causes}')>64 THEN
  RETURN controlled_count_v1.history_scan_saved_result_graph('reconciliation_preparation',p_id,validated_documents);
 END IF;
 BEGIN
 FOR source_row IN SELECT DISTINCT outcome_record.outcome_id,outcome_record.count_id,outcome_record.operation_id
  FROM jsonb_array_elements(preparation_row#>'{document,body,live_causes}')hint(value)
  JOIN controlled_count_v1.causes cause_record ON to_jsonb(cause_record.cause_id)=hint.value->'cause_id'
   AND to_jsonb(cause_record.product_id)=preparation_row->'product_id'AND to_jsonb(cause_record.site_id)=preparation_row->'site_id'
   AND cause_record.category='terminal_variance'
  JOIN controlled_count_v1.outcomes outcome_record ON outcome_record.outcome_id=cause_record.outcome_id
  JOIN controlled_count_v1.cycles cycle_record ON cycle_record.count_id=outcome_record.count_id
   AND to_jsonb(cycle_record.product_id)=preparation_row->'product_id'AND to_jsonb(cycle_record.site_id)=preparation_row->'site_id'
  ORDER BY outcome_record.outcome_id,outcome_record.count_id,outcome_record.operation_id LOOP
  memo_key:='cycle:'||source_row.count_id::text;
  IF NOT validated_documents?memo_key THEN
   SELECT to_jsonb(c)INTO STRICT cycle_row FROM controlled_count_v1.cycles c WHERE c.count_id=source_row.count_id;
   PERFORM controlled_count_v1.history_scan_validate_operation_graph((cycle_row->>'start_operation_id')::uuid,validated_documents);
   SELECT to_jsonb(o)INTO STRICT registry_row FROM controlled_count_v1.operations o WHERE o.operation_id=(cycle_row->>'start_operation_id')::uuid;
   -- A good unrelated registry must never certify a malformed hinted row.
   IF registry_row->>'result_kind'IS DISTINCT FROM'cycle'OR registry_row->'result_id'IS DISTINCT FROM to_jsonb(source_row.count_id)
   OR registry_row->'product_id'IS DISTINCT FROM cycle_row->'product_id'OR registry_row->'site_id'IS DISTINCT FROM cycle_row->'site_id'THEN
    RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
   cycle_document:=(controlled_count_v1.readcore_saved_result_row('cycle',source_row.count_id))->'document';
   IF octet_length(validated_documents::text)+octet_length(cycle_document::text)+octet_length(memo_key)+8<=16777216 THEN
    validated_documents:=validated_documents||jsonb_build_object(memo_key,cycle_document);
   END IF;
   SELECT to_jsonb(s)INTO STRICT snapshot_row FROM controlled_count_v1.snapshots s WHERE s.snapshot_id=(cycle_document#>>'{body,snapshot_id}')::uuid;
   snapshot_document:=snapshot_row->'document';
   IF snapshot_document->'id'IS DISTINCT FROM cycle_document#>'{body,snapshot_id}'
   OR snapshot_document->'record_hash'IS DISTINCT FROM cycle_document#>'{body,snapshot_hash}'
   OR snapshot_document->'record_hash'IS DISTINCT FROM snapshot_row->'record_hash'
   OR controlled_count_v1.document_hash(snapshot_document)IS DISTINCT FROM cycle_document#>>'{body,snapshot_hash}'THEN
    RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
   memo_key:='snapshot:'||(snapshot_document->>'id');
   IF octet_length(validated_documents::text)+octet_length(snapshot_document::text)+octet_length(memo_key)+8<=16777216 THEN
    validated_documents:=validated_documents||jsonb_build_object(memo_key,snapshot_document);
   END IF;
  END IF;
 END LOOP;
 FOR source_row IN SELECT DISTINCT outcome_record.outcome_id,outcome_record.count_id,outcome_record.operation_id
  FROM jsonb_array_elements(preparation_row#>'{document,body,live_causes}')hint(value)
  JOIN controlled_count_v1.causes cause_record ON to_jsonb(cause_record.cause_id)=hint.value->'cause_id'
   AND to_jsonb(cause_record.product_id)=preparation_row->'product_id'AND to_jsonb(cause_record.site_id)=preparation_row->'site_id'
   AND cause_record.category='terminal_variance'
  JOIN controlled_count_v1.outcomes outcome_record ON outcome_record.outcome_id=cause_record.outcome_id
  JOIN controlled_count_v1.cycles cycle_record ON cycle_record.count_id=outcome_record.count_id
   AND to_jsonb(cycle_record.product_id)=preparation_row->'product_id'AND to_jsonb(cycle_record.site_id)=preparation_row->'site_id'
  ORDER BY outcome_record.outcome_id,outcome_record.count_id,outcome_record.operation_id LOOP
  memo_key:='outcome:'||source_row.outcome_id::text;
  IF NOT validated_documents?memo_key THEN
   PERFORM controlled_count_v1.history_scan_validate_operation_graph(source_row.operation_id,validated_documents);
   SELECT to_jsonb(o)INTO STRICT registry_row FROM controlled_count_v1.operations o WHERE o.operation_id=source_row.operation_id;
   SELECT to_jsonb(o)INTO STRICT outcome_row FROM controlled_count_v1.outcomes o WHERE o.outcome_id=source_row.outcome_id;
   IF registry_row->>'result_kind'IS DISTINCT FROM'outcome'OR registry_row->'result_id'IS DISTINCT FROM to_jsonb(source_row.outcome_id)
   OR registry_row->'product_id'IS DISTINCT FROM outcome_row#>'{document,product_id}'OR registry_row->'site_id'IS DISTINCT FROM outcome_row#>'{document,site_id}'THEN
    RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
   document_value:=outcome_row->'document';
   IF octet_length(validated_documents::text)+octet_length(document_value::text)+octet_length(memo_key)+8<=16777216 THEN
    validated_documents:=validated_documents||jsonb_build_object(memo_key,document_value);
   END IF;
  END IF;
 END LOOP;
 EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
  WHEN OTHERS THEN
   -- A routing/optimization failure cannot change the original acceptance
   -- semantics. Discard ALL local reuse and run the original complete graph.
   -- The existing request/statement deadline is never renewed.
   validated_documents:='{}'::jsonb;
 END;
 -- Every original preparation/registry/cause/parent-boundary check still runs.
 RETURN controlled_count_v1.history_scan_saved_result_graph('reconciliation_preparation',p_id,validated_documents);
END $$;
'''


APPROVAL_GRAPH_SQL = '''CREATE FUNCTION controlled_count_v1.history_approval_graph(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,controlled_count_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
DECLARE approval_row jsonb;preparation_row jsonb;preparation_document jsonb;registry_row jsonb;validated_documents jsonb:='{}';memo_key text;
BEGIN
 PERFORM controlled_count_entry_v1.resource_origin_catalog_required();
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 SELECT to_jsonb(a)INTO STRICT approval_row FROM controlled_count_v1.reconciliation_approvals a WHERE a.approval_id=p_id;
 BEGIN
  SELECT to_jsonb(p)INTO STRICT preparation_row FROM controlled_count_v1.reconciliation_preparations p
   WHERE to_jsonb(p.preparation_id)=approval_row->'preparation_id';
  preparation_document:=controlled_count_v1.history_preparation_graph((preparation_row->>'preparation_id')::uuid);
  SELECT to_jsonb(o)INTO STRICT registry_row FROM controlled_count_v1.operations o WHERE to_jsonb(o.operation_id)=preparation_row->'operation_id';
  PERFORM controlled_count_v1.saved_registry_values(registry_row,preparation_document);
  IF preparation_document::text IS DISTINCT FROM(preparation_row->'document')::text
  OR preparation_document->'id'IS DISTINCT FROM preparation_row->'preparation_id'
  OR preparation_document->'record_hash'IS DISTINCT FROM preparation_row->'record_hash'
  OR preparation_document->>'record_hash'IS DISTINCT FROM controlled_count_v1.document_hash(preparation_document)
  OR preparation_document->'operation_id'IS DISTINCT FROM registry_row->'operation_id'
  OR registry_row->>'result_kind'IS DISTINCT FROM'reconciliation_preparation'
  OR registry_row->'result_id'IS DISTINCT FROM preparation_row->'preparation_id'
  OR registry_row->'product_id'IS DISTINCT FROM preparation_row->'product_id'
  OR registry_row->'site_id'IS DISTINCT FROM preparation_row->'site_id'THEN
   RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
  -- The complete result graph, registry and ORIGINAL operation closure all
  -- finish before this immutable document becomes available for local reuse.
  PERFORM controlled_count_v1.readcore_operation_closure_required((registry_row->>'operation_id')::uuid);
  memo_key:='reconciliation_preparation:'||(preparation_row->>'preparation_id');
  IF octet_length(validated_documents::text)+octet_length(preparation_document::text)+octet_length(memo_key)+8<=16777216 THEN
   validated_documents:=validated_documents||jsonb_build_object(memo_key,preparation_document);
  END IF;
 EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
  WHEN OTHERS THEN validated_documents:='{}'::jsonb;
 END;
 RETURN controlled_count_v1.history_scan_saved_result_graph('reconciliation_approval',p_id,validated_documents);
END $$;
'''

LIVE_CAUSE_ORIGINAL = '  cause_doc:=controlled_count_v1.readcore_saved_cause_graph(item.cause_id);'
LIVE_CAUSE_REUSE = '''  declare retained_cause_row jsonb;retained_source_row jsonb;retained_source_document jsonb;retained_kind text;retained_id uuid;
  begin
   select to_jsonb(c)into strict retained_cause_row from controlled_count_v1.causes c where c.cause_id=item.cause_id;
   if(retained_cause_row->'statement_id'is distinct from 'null'::jsonb)::integer
    +(retained_cause_row->'outcome_id'is distinct from 'null'::jsonb)::integer
    +(retained_cause_row->'cancellation_id'is distinct from 'null'::jsonb)::integer<>1 then
    raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
   if retained_cause_row->'statement_id'is distinct from 'null'::jsonb then retained_kind:='statement';retained_id:=(retained_cause_row->>'statement_id')::uuid;
   elsif retained_cause_row->'outcome_id'is distinct from 'null'::jsonb then retained_kind:='outcome';retained_id:=(retained_cause_row->>'outcome_id')::uuid;
   else retained_kind:='cancellation';retained_id:=(retained_cause_row->>'cancellation_id')::uuid;end if;
   retained_source_row:=controlled_count_v1.readcore_saved_result_row(retained_kind,retained_id);
   retained_source_document:=retained_source_row->'document';
   -- The SAME preceding complete first inventory selected this exact registry
   -- root and finished its graph+closure. A document product claim alone is
   -- insufficient: an orphan can be absent from joined result inventories.
   if retained_cause_row->'cause_id'=to_jsonb(item.cause_id)
    and retained_cause_row->'cause_id'=to_jsonb(controlled_count_v1.saved_cause_identifier(retained_kind,retained_id))
    and retained_source_document->'product_id'=to_jsonb(p_product)
    and retained_source_document->'id'=to_jsonb(retained_id)
    and retained_source_document->'record_hash'=retained_source_row->'record_hash'
    and retained_source_document->>'record_hash'=controlled_count_v1.document_hash(retained_source_document)
    and exists(select 1 from controlled_count_v1.operations o
     where to_jsonb(o.operation_id)=retained_source_document->'operation_id'
      and o.result_kind=retained_kind and o.result_id=retained_id
      and(o.product_id=p_product or o.document->'product_id'=to_jsonb(p_product)))then
    -- The completed registry graph also validated this exact deterministic
    -- cause row and its reciprocal source/category/hash. Held relation locks
    -- exclude concurrent writes; no write intervenes in this invocation.
    cause_doc:=retained_cause_row->'document';
   else cause_doc:=controlled_count_v1.readcore_saved_cause_graph(item.cause_id);end if;
  end;'''
LIVE_RESOLUTION_ORIGINAL = "   resolution_doc:=controlled_count_v1.readcore_saved_result_graph('cause_resolution',resolution_value);"
LIVE_RESOLUTION_REUSE = '''   declare retained_resolution_row jsonb;retained_resolution_document jsonb;
   begin
    retained_resolution_row:=controlled_count_v1.readcore_saved_result_row('cause_resolution',resolution_value);
    retained_resolution_document:=retained_resolution_row->'document';
    if retained_resolution_document->'product_id'=to_jsonb(p_product)
     and retained_resolution_document->'id'=to_jsonb(resolution_value)
     and retained_resolution_document->'record_hash'=retained_resolution_row->'record_hash'
     and retained_resolution_document->>'record_hash'=controlled_count_v1.document_hash(retained_resolution_document)
     and exists(select 1 from controlled_count_v1.operations o
      where to_jsonb(o.operation_id)=retained_resolution_document->'operation_id'
       and o.result_kind='cause_resolution'and o.result_id=resolution_value
       and(o.product_id=p_product or o.document->'product_id'=to_jsonb(p_product)))then
     resolution_doc:=retained_resolution_document;
    else resolution_doc:=controlled_count_v1.readcore_saved_result_graph('cause_resolution',resolution_value);end if;
   end;'''
LIVE_CAUSE_EDITS = ((LIVE_CAUSE_ORIGINAL, LIVE_CAUSE_REUSE), (LIVE_RESOLUTION_ORIGINAL, LIVE_RESOLUTION_REUSE))


EXECUTION_GRAPH_SQL = '''CREATE FUNCTION controlled_count_v1.history_execution_graph(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,controlled_count_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
DECLARE execution_row jsonb;approval_row jsonb;preparation_row jsonb;approval_document jsonb;preparation_document jsonb;
 registry_row jsonb;validated_documents jsonb:='{}';memo_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.resource_origin_catalog_required();
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 SELECT to_jsonb(e)INTO STRICT execution_row FROM controlled_count_v1.reconciliation_executions e WHERE e.execution_id=p_id;
 BEGIN
  SELECT to_jsonb(a)INTO STRICT approval_row FROM controlled_count_v1.reconciliation_approvals a
   WHERE to_jsonb(a.approval_id)=execution_row->'approval_id';
  -- Complete approval validation also completes its exact preparation graph.
  -- No current authorization, live effects or execution boundary is reused.
  approval_document:=controlled_count_v1.history_approval_graph((approval_row->>'approval_id')::uuid);
  SELECT to_jsonb(p)INTO STRICT preparation_row FROM controlled_count_v1.reconciliation_preparations p
   WHERE to_jsonb(p.preparation_id)=execution_row->'preparation_id';
  preparation_document:=preparation_row->'document';
  IF approval_row->'preparation_id'IS DISTINCT FROM preparation_row->'preparation_id'
  OR approval_document#>'{body,preparation_id}'IS DISTINCT FROM preparation_row->'preparation_id'
  OR approval_document#>'{body,preparation_hash}'IS DISTINCT FROM preparation_row->'record_hash'
  OR approval_document::text IS DISTINCT FROM(approval_row->'document')::text
  OR approval_document->'id'IS DISTINCT FROM approval_row->'approval_id'
  OR approval_document->'record_hash'IS DISTINCT FROM approval_row->'record_hash'
  OR approval_document->>'record_hash'IS DISTINCT FROM controlled_count_v1.document_hash(approval_document)
  OR preparation_document->'id'IS DISTINCT FROM preparation_row->'preparation_id'
  OR preparation_document->'record_hash'IS DISTINCT FROM preparation_row->'record_hash'
  OR preparation_document->>'record_hash'IS DISTINCT FROM controlled_count_v1.document_hash(preparation_document)THEN
   RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
  SELECT to_jsonb(o)INTO STRICT registry_row FROM controlled_count_v1.operations o WHERE to_jsonb(o.operation_id)=preparation_row->'operation_id';
  PERFORM controlled_count_v1.saved_registry_values(registry_row,preparation_document);
  IF preparation_document->'operation_id'IS DISTINCT FROM registry_row->'operation_id'
  OR registry_row->>'result_kind'IS DISTINCT FROM'reconciliation_preparation'
  OR registry_row->'result_id'IS DISTINCT FROM preparation_row->'preparation_id'
  OR registry_row->'product_id'IS DISTINCT FROM preparation_row->'product_id'
  OR registry_row->'site_id'IS DISTINCT FROM preparation_row->'site_id'THEN
   RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
  PERFORM controlled_count_v1.readcore_operation_closure_required((registry_row->>'operation_id')::uuid);
  SELECT to_jsonb(o)INTO STRICT registry_row FROM controlled_count_v1.operations o WHERE to_jsonb(o.operation_id)=approval_row->'operation_id';
  PERFORM controlled_count_v1.saved_registry_values(registry_row,approval_document);
  IF approval_document->'operation_id'IS DISTINCT FROM registry_row->'operation_id'
  OR registry_row->>'result_kind'IS DISTINCT FROM'reconciliation_approval'
  OR registry_row->'result_id'IS DISTINCT FROM approval_row->'approval_id'
  OR registry_row->'product_id'IS DISTINCT FROM approval_document->'product_id'
  OR registry_row->'site_id'IS DISTINCT FROM approval_document->'site_id'
  OR registry_row->'product_id'IS DISTINCT FROM preparation_row->'product_id'
  OR registry_row->'site_id'IS DISTINCT FROM preparation_row->'site_id'THEN
   RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
  PERFORM controlled_count_v1.readcore_operation_closure_required((registry_row->>'operation_id')::uuid);
  -- Publish neither ancestor until BOTH complete graphs/registry bindings and
  -- original closures are proved. Reuse remains local to this invocation.
  memo_value:=validated_documents||jsonb_build_object('reconciliation_preparation:'||(preparation_row->>'preparation_id'),preparation_document,
   'reconciliation_approval:'||(approval_row->>'approval_id'),approval_document);
  IF octet_length(memo_value::text)<=16777216 THEN validated_documents:=memo_value;END IF;
 EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
  WHEN OTHERS THEN validated_documents:='{}'::jsonb;
 END;
 RETURN controlled_count_v1.history_scan_saved_result_graph('reconciliation_execution',p_id,validated_documents);
END $$;
'''


def seed_policy_grammar(row_name):
    """Validate full policy grammar once; no history/permission result is cached."""
    if row_name not in ('preparation_row','approval_row','execution_row','resolution_row'):
        raise ValueError('Fixed source-owned result-row binding required')
    policy_id="("+row_name+("#>>'{document,policy,id}')"if row_name in('execution_row','resolution_row')else"->>'policy_id')")
    return '''
 declare grammar_row controlled_count_v1.policies;grammar_document jsonb;grammar_key text;
 begin
  select *into strict grammar_row from controlled_count_v1.policies p where p.policy_id='''+policy_id+'''::uuid;
  grammar_document:=grammar_row.document;grammar_key:='policy_values:'||grammar_row.policy_id::text;
  if grammar_document->'policy_id'=to_jsonb(grammar_row.policy_id)
   and grammar_document->'product_id'=to_jsonb(grammar_row.product_id)and grammar_document->'site_id'=to_jsonb(grammar_row.site_id)
   and grammar_document->'version'=to_jsonb(grammar_row.version)
   and grammar_document->>'record_hash'=grammar_row.record_hash
   and controlled_count_v1.document_hash(grammar_document)=grammar_row.record_hash
   and(validated_documents->grammar_key)::text is distinct from grammar_document::text then
   -- This is the complete ORIGINAL pure grammar validator. All subsequent
   -- complete policy histories, capabilities and live authority still run.
   perform controlled_count_v1.policy_values(grammar_document);
   if octet_length(validated_documents::text)+octet_length(grammar_document::text)+octet_length(grammar_key)+8<=16777216 then
    validated_documents:=validated_documents||jsonb_build_object(grammar_key,grammar_document);
   end if;
  end if;
 exception when query_canceled or assert_failure then raise;
  when others then null; -- An ineligible seed leaves the full original path.
 end;
'''


def add_policy_grammar_seed(program,row_name,anchor):
    if program.count(anchor)!=1:
        raise ValueError('Exact private helper source-row entry required')
    return program.replace(anchor,anchor+seed_policy_grammar(row_name),1)


def helper_closure_context(program,expected_calls):
    marker=' AS $$';start=program.index(marker)+len(marker);end=program.index('$$;',start)
    before=program[start:end]
    mapping={'controlled_count_v1.readcore_operation_closure_required':'controlled_count_v1.history_scan_operation_closure_required',
             'controlled_count_v1.saved_registry_values':'controlled_count_v1.history_scan_saved_registry_values'}
    for name in mapping:
        if len(re.findall(re.escape(name)+r'\s*\(',code_mask(before)))!=expected_calls:
            raise ValueError('Exact helper closure and registry call counts required')
    after,count=retarget_calls(before,mapping,argument='validated_documents')
    restored,inverse_count=retarget_calls(after,{new:old for old,new in mapping.items()},inverse=True,argument='validated_documents')
    if count!=2*expected_calls or restored!=before or inverse_count!=count:
        raise ValueError('Whole helper closure-call context inverse required')
    return program[:start]+after+program[end:]


RESOLUTION_GRAPH_SQL = '''CREATE FUNCTION controlled_count_v1.history_resolution_graph(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,controlled_count_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
DECLARE resolution_row jsonb;post_cycle jsonb;post_outcome jsonb;cycle_document jsonb;snapshot_row jsonb;snapshot_document jsonb;
 cause_row jsonb;source_kind text;source_id uuid;source_row jsonb;source_document jsonb;source_cycle jsonb;
 confirmation_row jsonb;confirmation_document jsonb;execution_row jsonb;preparation_row jsonb;approval_row jsonb;
 targets jsonb;target jsonb;kind_value text;id_value uuid;retained_row jsonb;document_value jsonb;registry_row jsonb;
 validated_documents jsonb:='{}';memo_key text;stage_value integer;
BEGIN
 PERFORM controlled_count_entry_v1.resource_origin_catalog_required();
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 SELECT to_jsonb(r)INTO STRICT resolution_row FROM controlled_count_v1.resolutions r WHERE r.resolution_id=p_id;
 BEGIN
  SELECT to_jsonb(c)INTO STRICT post_cycle FROM controlled_count_v1.cycles c WHERE to_jsonb(c.count_id)=resolution_row->'post_count_id';
  SELECT to_jsonb(o)INTO STRICT post_outcome FROM controlled_count_v1.outcomes o WHERE to_jsonb(o.count_id)=resolution_row->'post_count_id';
  FOR stage_value IN 1..4 LOOP
   targets:='[]';
   IF stage_value=1 THEN
    PERFORM controlled_count_v1.history_scan_validate_operation_graph((post_cycle->>'start_operation_id')::uuid,validated_documents);
    targets:=jsonb_build_array(jsonb_build_object('kind','cycle','id',post_cycle->'count_id'));
   ELSIF stage_value=2 THEN
    PERFORM controlled_count_v1.history_scan_validate_operation_graph((post_outcome->>'operation_id')::uuid,validated_documents);
    -- This COMPLETE outcome graph has now validated both exact statements,
    -- the cycle and its snapshot. Closures are checked again before reuse.
    targets:=jsonb_build_array(jsonb_build_object('kind','outcome','id',post_outcome->'outcome_id'),
     jsonb_build_object('kind','statement','id',post_outcome->'statement_a_id'),jsonb_build_object('kind','statement','id',post_outcome->'statement_b_id'));
   ELSIF stage_value=3 THEN
    SELECT to_jsonb(c)INTO STRICT cause_row FROM controlled_count_v1.causes c WHERE to_jsonb(c.cause_id)=resolution_row->'cause_id';
    IF(cause_row->'statement_id'IS DISTINCT FROM'null'::jsonb)::integer
     +(cause_row->'outcome_id'IS DISTINCT FROM'null'::jsonb)::integer
     +(cause_row->'cancellation_id'IS DISTINCT FROM'null'::jsonb)::integer<>1 THEN
     RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
    IF cause_row->'statement_id'IS DISTINCT FROM'null'::jsonb THEN source_kind:='statement';source_id:=(cause_row->>'statement_id')::uuid;
    ELSIF cause_row->'outcome_id'IS DISTINCT FROM'null'::jsonb THEN source_kind:='outcome';source_id:=(cause_row->>'outcome_id')::uuid;
    ELSE source_kind:='cancellation';source_id:=(cause_row->>'cancellation_id')::uuid;END IF;
    PERFORM controlled_count_v1.history_scan_saved_cause_graph((cause_row->>'cause_id')::uuid,validated_documents);
    source_row:=controlled_count_v1.readcore_saved_result_row(source_kind,source_id);source_document:=source_row->'document';
    SELECT to_jsonb(c)INTO STRICT source_cycle FROM controlled_count_v1.cycles c WHERE to_jsonb(c.count_id)=source_row->'count_id';
    IF source_document#>'{body,count_id}'IS DISTINCT FROM source_cycle->'count_id'
    OR source_document#>'{body,cycle_hash}'IS DISTINCT FROM source_cycle#>'{document,record_hash}'
    OR source_document#>'{body,snapshot_id}'IS DISTINCT FROM source_cycle->'snapshot_id'
    OR source_document#>'{body,snapshot_id}'IS DISTINCT FROM source_cycle#>'{document,body,snapshot_id}'
    OR source_document#>'{body,snapshot_hash}'IS DISTINCT FROM source_cycle#>'{document,body,snapshot_hash}'THEN
     RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
    -- The completed cause graph also validated its original source cycle and
    -- snapshot. The final resolution checks both source cells again; retain
    -- their exact validated ancestors alongside the post-count ancestors.
    targets:=jsonb_build_array(jsonb_build_object('kind',source_kind,'id',source_id),
     jsonb_build_object('kind','cycle','id',source_cycle->'count_id'));
   ELSE
    IF resolution_row->'confirmation_id'='null'::jsonb THEN CONTINUE;END IF;
    SELECT to_jsonb(c)INTO STRICT confirmation_row FROM controlled_count_v1.reconciliation_confirmations c WHERE to_jsonb(c.confirmation_id)=resolution_row->'confirmation_id';
    confirmation_document:=controlled_count_v1.readcore_saved_result_graph('reconciliation_confirmation',(confirmation_row->>'confirmation_id')::uuid);
    SELECT to_jsonb(e)INTO STRICT execution_row FROM controlled_count_v1.reconciliation_executions e WHERE to_jsonb(e.execution_id)=confirmation_row->'execution_id';
    SELECT to_jsonb(p)INTO STRICT preparation_row FROM controlled_count_v1.reconciliation_preparations p WHERE to_jsonb(p.preparation_id)=execution_row->'preparation_id';
    SELECT to_jsonb(a)INTO STRICT approval_row FROM controlled_count_v1.reconciliation_approvals a WHERE to_jsonb(a.approval_id)=execution_row->'approval_id';
    IF confirmation_document::text IS DISTINCT FROM(confirmation_row->'document')::text
    OR confirmation_document#>'{body,execution_id}'IS DISTINCT FROM execution_row->'execution_id'
    OR confirmation_document#>'{body,execution_hash}'IS DISTINCT FROM execution_row->'record_hash'
    OR execution_row#>'{document,body,preparation_id}'IS DISTINCT FROM preparation_row->'preparation_id'
    OR execution_row#>'{document,body,preparation_hash}'IS DISTINCT FROM preparation_row->'record_hash'
    OR execution_row#>'{document,body,approval_id}'IS DISTINCT FROM approval_row->'approval_id'
    OR execution_row#>'{document,body,approval_hash}'IS DISTINCT FROM approval_row->'record_hash'
    OR approval_row->'preparation_id'IS DISTINCT FROM preparation_row->'preparation_id'THEN
     RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
    targets:=jsonb_build_array(jsonb_build_object('kind','reconciliation_confirmation','id',confirmation_row->'confirmation_id'),
     jsonb_build_object('kind','reconciliation_execution','id',execution_row->'execution_id'),jsonb_build_object('kind','reconciliation_preparation','id',preparation_row->'preparation_id'),
     jsonb_build_object('kind','reconciliation_approval','id',approval_row->'approval_id'));
   END IF;
   FOR target IN SELECT value FROM jsonb_array_elements(targets)LOOP
    kind_value:=target->>'kind';id_value:=(target->>'id')::uuid;
    retained_row:=controlled_count_v1.readcore_saved_result_row(kind_value,id_value);document_value:=retained_row->'document';
    SELECT to_jsonb(o)INTO STRICT registry_row FROM controlled_count_v1.operations o WHERE to_jsonb(o.operation_id)=document_value->'operation_id';
    PERFORM controlled_count_v1.saved_registry_values(registry_row,document_value);
    IF document_value->'id'IS DISTINCT FROM to_jsonb(id_value)
    OR document_value->'record_hash'IS DISTINCT FROM retained_row->'record_hash'
    OR document_value->>'record_hash'IS DISTINCT FROM controlled_count_v1.document_hash(document_value)
    OR document_value->'operation_id'IS DISTINCT FROM(CASE WHEN kind_value='cycle'THEN retained_row->'start_operation_id'ELSE retained_row->'operation_id'END)
    OR registry_row->>'result_kind'IS DISTINCT FROM kind_value OR registry_row->'result_id'IS DISTINCT FROM to_jsonb(id_value)
    OR registry_row->'product_id'IS DISTINCT FROM document_value->'product_id'OR registry_row->'site_id'IS DISTINCT FROM document_value->'site_id'
    OR registry_row->'product_id'IS DISTINCT FROM post_cycle->'product_id'OR registry_row->'site_id'IS DISTINCT FROM post_cycle->'site_id'THEN
     RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
    PERFORM controlled_count_v1.readcore_operation_closure_required((registry_row->>'operation_id')::uuid);
    memo_key:=kind_value||':'||id_value::text;
    IF octet_length(validated_documents::text)+octet_length(document_value::text)+octet_length(memo_key)+8<=16777216 THEN
     validated_documents:=validated_documents||jsonb_build_object(memo_key,document_value);
    END IF;
   END LOOP;
   IF stage_value IN(1,3)THEN
    IF stage_value=1 THEN cycle_document:=post_cycle->'document';ELSE cycle_document:=source_cycle->'document';END IF;
    SELECT to_jsonb(s)INTO STRICT snapshot_row FROM controlled_count_v1.snapshots s WHERE to_jsonb(s.snapshot_id)=cycle_document#>'{body,snapshot_id}';
    snapshot_document:=snapshot_row->'document';
    IF snapshot_document->'id'IS DISTINCT FROM cycle_document#>'{body,snapshot_id}'
    OR snapshot_document->'id'IS DISTINCT FROM snapshot_row->'snapshot_id'
    OR snapshot_document->'count_id'IS DISTINCT FROM snapshot_row->'count_id'
    OR snapshot_document->'count_id'IS DISTINCT FROM cycle_document->'id'
    OR snapshot_document->'product_id'IS DISTINCT FROM cycle_document->'product_id'
    OR snapshot_document->'site_id'IS DISTINCT FROM cycle_document->'site_id'
    OR snapshot_document->'record_hash'IS DISTINCT FROM cycle_document#>'{body,snapshot_hash}'
    OR snapshot_document->'record_hash'IS DISTINCT FROM snapshot_row->'record_hash'
    OR snapshot_document->>'record_hash'IS DISTINCT FROM controlled_count_v1.document_hash(snapshot_document)THEN
     RAISE EXCEPTION 'count_source_invalid'using errcode='P0001',detail='',hint='';END IF;
    memo_key:='snapshot:'||(snapshot_document->>'id');
    IF octet_length(validated_documents::text)+octet_length(snapshot_document::text)+octet_length(memo_key)+8<=16777216 THEN
     validated_documents:=validated_documents||jsonb_build_object(memo_key,snapshot_document);
    END IF;
   END IF;
  END LOOP;
 EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
  WHEN OTHERS THEN validated_documents:='{}'::jsonb;
 END;
 -- Existing root evidence/freshness/source-cell/cause association checks run
 -- in full. Only completed immutable ancestor documents can be read faster.
 RETURN controlled_count_v1.history_scan_saved_result_graph('cause_resolution',p_id,validated_documents);
END $$;
'''

PREPARATION_GRAPH_SQL=add_policy_grammar_seed(PREPARATION_GRAPH_SQL,'preparation_row',
    ' SELECT to_jsonb(p)INTO STRICT preparation_row FROM controlled_count_v1.reconciliation_preparations p WHERE p.preparation_id=p_id;')
APPROVAL_GRAPH_SQL=add_policy_grammar_seed(APPROVAL_GRAPH_SQL,'approval_row',
    ' SELECT to_jsonb(a)INTO STRICT approval_row FROM controlled_count_v1.reconciliation_approvals a WHERE a.approval_id=p_id;')
EXECUTION_GRAPH_SQL=add_policy_grammar_seed(EXECUTION_GRAPH_SQL,'execution_row',
    ' SELECT to_jsonb(e)INTO STRICT execution_row FROM controlled_count_v1.reconciliation_executions e WHERE e.execution_id=p_id;')
RESOLUTION_GRAPH_SQL=add_policy_grammar_seed(RESOLUTION_GRAPH_SQL,'resolution_row',
    ' SELECT to_jsonb(r)INTO STRICT resolution_row FROM controlled_count_v1.resolutions r WHERE r.resolution_id=p_id;')

PREPARATION_GRAPH_SQL=helper_closure_context(PREPARATION_GRAPH_SQL,0)
APPROVAL_GRAPH_SQL=helper_closure_context(APPROVAL_GRAPH_SQL,1)
EXECUTION_GRAPH_SQL=helper_closure_context(EXECUTION_GRAPH_SQL,2)
RESOLUTION_GRAPH_SQL=helper_closure_context(RESOLUTION_GRAPH_SQL,1)


def deduplicate_deferred_operation(body):
    """The final complete product inventory validates the same actual operation."""
    import hashlib
    original_hash='f2039746e67cb527d8b82a6b647c1c0f6da65b6c60b9918f9dfb322f2487f88d'
    if hashlib.sha256(body.encode()).hexdigest()!=original_hash:
        raise ValueError('Exact original deferred callback source required')
    old=""" if TG_TABLE_NAME<>'open_causes'then
  if operation_value is null then raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.validate_operation_graph(operation_value);
  select o.product_id into strict product_value from controlled_count_v1.operations o where o.operation_id=operation_value;
 end if;"""
    frontier='perform controlled_count_entry_v1.assert_read_frontier();'
    child='perform controlled_count_v1.validate_operation_graph(operation_value);'
    complete='perform controlled_count_v1.product_live_causes(product_value);'
    new=old.replace(child,frontier,1)
    if body.count(old)!=1 or body.count(child)!=1 or body.count(frontier)!=1 or body.count(complete)!=1:
        raise ValueError('Exact deferred operation lookup and complete product history required')
    after=body.replace(old,new,1)
    if after.count(new)!=1 or after.replace(new,old,1)!=body:
        raise ValueError('Whole deferred callback inverse required')
    if after.count(frontier)!=2 or child in after or after.count(complete)!=1:
        raise ValueError('Both fresh frontiers and final complete product graph required')
    return after,dict(original_body_sha256=original_hash,new_body_sha256=hashlib.sha256(after.encode()).hexdigest(),
        whole_body_inverse=True,actual_operation_lookup_retained=True,complete_final_product_history_unchanged=True,
        original_callback_frontier_retained=True,removed_only_locally_dominated_child_validation=True,
        no_cross_trigger_or_persisted_validation=True)
