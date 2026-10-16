"""Explicit, bounded real-provider lexical smoke evaluation (five fictional recordings).

Not clinician validation or an accuracy benchmark. Maximum ten paid calls; no retries.
Uses the existing staging secret without reading it. Each temporary fixed-input endpoint
is service-authenticated, expires and is deleted by synthetic-provider.py.
"""
import argparse, json, re, subprocess
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
mode=p.add_mutually_exclusive_group(required=True)
mode.add_argument('--run-synthetic-provider',action='store_true')
mode.add_argument('--review-receipt',type=Path,help='Recheck saved synthetic results locally without any provider call')
args=p.parse_args()
root=Path(__file__).resolve().parents[2]
receipts=[]
saved=json.loads(args.review_receipt.read_text())['fixtures'] if args.review_receipt else None
try:
 for fixture in ['baseline','shorthand','medication','vaccines','ambiguity']:
  if saved is None: subprocess.run(['python3','-B',str(root/'tests/clinical-audio/synthetic-provider.py'),'--run-synthetic-provider','--fixture',fixture],check=True,timeout=300)
  r=next(x for x in saved if x['fixture']==fixture) if saved is not None else json.loads((root/'tmp/clinical-audio-synthetic-provider.json').read_text());receipts.append(r)
  assert r['temporary_function_removed'] and not r['clinical_database_used'] and not r['clinical_flags_changed']
  assert [s['status']for s in r['statuses']]==[200,200] and len(r['calls'])==2 and not r['failures']
  transcript=r['results'][0]['payload']['text'];payload=r['results'][1]['payload']
  for result in r['results']:
   assert result['language_context']['version']=='lrv-vet-en-v1'
  assert r['results'][0]['language_context']['bundle_sha256']==r['results'][1]['language_context']['bundle_sha256']
  for section in ['subjective','objective','assessment','plan']:
   for claim in payload[section]: assert claim['quote'] in transcript
  combined=' '.join(c['text'] for k in ['subjective','objective','assessment','plan']for c in payload[k]).lower()
  # Negated administrative/missing-source statements are not fabricated exam findings.
  # Review actual wording: a strict empty-array test rejected valid source-backed statements.
  no_fabricated_exam=all(re.fullmatch(r'no (?:medication was administered today|vaccines? (?:was|were) administered|(?:objective )?(?:physical )?examination findings were dictated|(?:objective )?examination was dictated)\.?',c['text'],re.I)for c in payload['objective'])
  all_text=combined+' '+' '.join(payload['review_flags']).lower()
  no_vomiting=bool(re.search(r'no vomiting|absence of vomiting|without vomiting|vomiting (?:is |was )?(?:denied|absent)|denies vomiting',combined))
  checks=[]
  def check(condition,label):
   checks.append({'check':label,'passed':bool(condition)})
  if fixture=='baseline':
   check(not re.search(r'cerenia|convenia|rabies|bordetella|carprofen',transcript,re.I),'no unspoken vocabulary leakage')
   check(no_fabricated_exam,'no fabricated exam')
   check(no_vomiting,'negated symptom preserved')
  elif fixture=='shorthand':
   for term in ['ADR','BAR','CBC','rads']: check(bool(re.search(r'\b'+term+r'\b',transcript,re.I)),term+' recognized')
   check(no_vomiting,'negation retained')
   check(not re.search(r'letharg|anorex|inappeten',combined),'ADR did not invent specific symptoms')
   check(any('recommend' in c['text'].lower() or 'plan' in c['text'].lower() for c in payload['plan']),'diagnostics remain planned')
  elif fixture=='medication':
   check('Cerenia' in transcript and 'Convenia' in transcript,'distinct medication names recognized')
   check('0.5' in all_text or 'zero point five' in all_text,'decimal dose retained without conversion')
   check('no medication' in combined or 'not administer' in combined,'no administration inferred')
   check(no_fabricated_exam,'no fabricated exam')
  elif fixture=='vaccines':
   check('rabies' in transcript.lower() and 'bordetella' in transcript.lower(),'vaccine names recognized')
   check('declin' in combined,'declined care retained')
   check('not verified' in combined or 'unverified' in combined,'status uncertainty retained')
   check(no_fabricated_exam,'no fabricated exam')
  elif fixture=='ambiguity':
   check(bool(re.search(r'\bdex\b',transcript,re.I)),'drug nickname preserved')
   check(any('Veterinary terminology needs clinician confirmation' in f for f in payload['review_flags']),'deterministic review warning present')
   check(not re.search(r'dexamethasone|dexmedetomidine|prednisone|prednisolone',combined),'no guessed drug expansion')
   check(no_fabricated_exam,'no fabricated exam')
  r['checks']=checks;r['passed']=all(c['passed']for c in checks)
  print(json.dumps({'fixture':fixture,'checks':checks,'passed':r['passed']}),flush=True)
finally:
 (root/'tmp').mkdir(exist_ok=True)
 (root/'tmp/veterinary-vocabulary-provider-eval.json').write_text(json.dumps({'synthetic_only':True,'maximum_paid_calls_per_run':10,'provider_calls_this_run':0 if saved is not None else sum(len(x['calls'])for x in receipts),'assertions_revision':2,'fixtures':receipts,'passed':len(receipts)==5 and all(r.get('passed')for r in receipts)},indent=2)+'\n')
assert len(receipts)==5 and all(r.get('passed')for r in receipts),'Review failed synthetic checks; no clinical activation'
