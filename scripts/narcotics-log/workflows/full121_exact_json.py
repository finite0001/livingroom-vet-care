"""Lossless PG-emitted JSONB value DATA; never authorizes an app operation.

Numeric spelling is retained. JSONB output from genuine PG is already numeric
normalized; this module does not claim to normalize arbitrary JSON into JSONB.
"""
from dataclasses import dataclass
from hashlib import sha256
import json,re
@dataclass(frozen=True)
class Number:
 token:str
 def __post_init__(self):
  if not re.fullmatch(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?',self.token):raise ValueError('Invalid JSON numeric token')

def _decode(raw,cap):
 if type(raw)is not bytes or not 0<len(raw)<=cap:raise ValueError('Raw exact HTTP response bound exceeded')
 def pairs(items):
  out={}
  for k,v in items:
   if k in out:raise ValueError('Duplicate exact JSON key')
   out[k]=v
  return out
 def bad(value):raise ValueError('Nonfinite JSON number')
 out=json.loads(raw.decode('utf8',errors='strict'),parse_int=Number,parse_float=Number,parse_constant=bad,object_pairs_hook=pairs)
 nodes=0
 def check(v,depth=0):
  nonlocal nodes
  nodes+=1
  if nodes>1000000:raise ValueError('Exact JSON work bound')
  if depth>64:raise ValueError('Exact JSON depth')
  if type(v)is str:
   if '\0'in v:raise ValueError('NUL cannot inhabit PG JSONB')
   v.encode('utf8',errors='strict')
  elif type(v)is dict:
   for k,x in v.items():check(k,depth+1);check(x,depth+1)
  elif type(v)is list:
   for x in v:check(x,depth+1)
 check(out);return out

def pg_text(value):
 if value is None:return 'null'
 if type(value)is bool:return 'true'if value else 'false'
 if type(value)is Number:return value.token
 if type(value)is str:return json.dumps(value,ensure_ascii=False,separators=(',',':'))
 if type(value)is list:return '['+', '.join(pg_text(x)for x in value)+']'
 if type(value)is dict:return '{'+', '.join(pg_text(k)+': '+pg_text(value[k])for k in sorted(value,key=lambda k:(len(k.encode()),k.encode())))+'}'
 raise ValueError('Only losslessly decoded PG JSONB values')
P8=('version','id','writer','actor_id','canonical_arguments','context','frozen','expires_at')
def immutable_preparation(parent):
 if type(parent)is not dict or not set(P8)<=set(parent):raise ValueError('Full original preparation missing')
 return {k:parent[k]for k in P8}
def preparation_digest(parent):
 return sha256(b'lrv-controlled-stock-witness-preparation-v1\0'+pg_text(immutable_preparation(parent)).encode()).hexdigest()

def decode(raw):return _decode(raw,2097152)
def decode_pb(raw):return _decode(raw,16777216)
