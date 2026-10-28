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


def retarget_calls(body, mapping, *, inverse=False):
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
            suffix = ',' + ARGUMENT
            if body[closing - len(suffix):closing] != suffix:
                raise ValueError('Exact private argument inverse required')
            edits.append((closing - len(suffix), closing, ''))
        else:
            if not body[opening + 1:closing].strip():
                raise ValueError('Only original nonzero-argument graph helpers are admitted')
            edits.append((closing, closing, ',' + ARGUMENT))
        edits.append((match.start('name'), match.end('name'), mapping[match['name']]))
        calls += 1
    result = body
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    return result, calls


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
  end if;'''

ROOT_EDITS = (
    ('declare item record;document_value jsonb;', "declare item record;document_value jsonb;validated_documents jsonb:='{}'::jsonb;operation_row jsonb;memo_key text;"),
    (' order by o.operation_id loop', ''' order by case o.result_kind when 'policy'then 0 when 'cycle'then 1 when 'statement'then 2 when 'outcome'then 3 when 'cancellation'then 3
 when 'reconciliation_preparation'then 4 when 'reconciliation_approval'then 5 when 'reconciliation_execution'then 6 when 'reconciliation_confirmation'then 7 when 'cause_resolution'then 8 else 99 end,o.operation_id loop'''),
    (ROOT_CALL_BEFORE, ROOT_CALL_AFTER),
)
