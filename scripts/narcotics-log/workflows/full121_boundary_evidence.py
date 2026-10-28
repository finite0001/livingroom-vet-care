"""Fixed PB50 owner DATA capture and exact parent HTTP/row comparisons."""
from hashlib import sha256
import full121_exact_json as exact_json

def capture(ctx,m,runtime,stage):
 r=m['full_capture'].capture(runtime,stage,m['full_components'],m['full_payload'],ctx['ids']['product'],ctx['ids']['site'])
 if type(r)is not dict or type(r['raw'])is not bytes or not 0<len(r['raw'])<=16777216 or sha256(r['raw']).hexdigest()!=r['sha256']:raise ValueError('Fixed owner50 DATA capture malformed')
 return dict(sha256=r['sha256'],bytes=len(r['raw']),diagnostic=r['diagnostic'])

def raw_capture(ctx,m,runtime,stage):
 r=m['full_capture'].capture(runtime,stage,m['full_components'],m['full_payload'],ctx['ids']['product'],ctx['ids']['site'])
 if type(r)is not dict or type(r['raw'])is not bytes or not 0<len(r['raw'])<=16777216 or sha256(r['raw']).hexdigest()!=r['sha256']:raise ValueError('Fixed owner50 DATA capture malformed')
 return r

def exact_response(http,expected_rpc):
 index=len(http.calls);ref=http.raw_response_at(index)
 if ref['call_index']!=index or ref['path']!='/rest/v1/rpc/'+expected_rpc or http.calls[index-1]['path']!=ref['path']or type(ref['raw'])is not bytes or sha256(ref['raw']).hexdigest()!=ref['response_sha256']or ref['request_sha256']!=http.calls[index-1]['request_sha256']or ref['response_sha256']!=http.calls[index-1]['response_sha256']:raise ValueError('Exact raw HTTP provenance differs')
 return ref['raw']

def posted_receipt(ctx,m,runtime,stage,operation,raw_http):
 r=raw_capture(ctx,m,runtime,stage);pb=exact_json.decode_pb(r['raw']);response=exact_json.decode(raw_http)
 if type(pb)is not dict or len(pb)!=50 or type(pb.get('actions'))is not list or type(pb.get('events'))is not list:raise ValueError('Complete source50 flat PB object required')
 actions=[x for x in pb['actions']if x['id']==operation];events=[x for x in pb['events']if x['id']==operation]
 if len(actions)!=1 or len(events)!=1:raise ValueError('Actual posted operation missing/duplicated in complete PB')
 receipt=response['data']['receipt']
 if exact_json.pg_text(actions[0]['receipt'])!=exact_json.pg_text(receipt)or exact_json.pg_text(events[0])!=exact_json.pg_text(receipt['event'])or exact_json.pg_text(receipt['canonical_result'])!=exact_json.pg_text(response['data']['canonical_result']):raise ValueError('Actual parent membership/HTTP receipt/result numeric spelling differs')
 return dict(sha256=r['sha256'],bytes=len(r['raw']),diagnostic=r['diagnostic'],operation_id=operation)
