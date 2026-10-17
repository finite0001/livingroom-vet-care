"""Render frozen fictional sources and all generated claims for offline human review.

No networking or semantic auto-grading. Engineering annotations and independent
clinical adjudication remain separate; rendering a packet approves no policy.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re


def fenced(value):
    content = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    longest = max((len(m.group()) for m in re.finditer(r'`+', content)), default=0)
    fence = '`' * max(3, longest + 1)
    return fence + '\n' + content + '\n' + fence + '\n'



def assistant_messages(raw):
    """Expose assistant output text/refusal only, never arbitrary provider metadata."""
    output = raw.get('output') if isinstance(raw, dict) else None
    if not isinstance(output, list):
        return [{'malformed_or_missing_output': True}]
    messages = []
    for item in output:
        if not isinstance(item, dict):
            messages.append({'malformed_output_item': True})
            continue
        if item.get('type') == 'reasoning':
            continue
        if item.get('type') != 'message':
            messages.append({'unexpected_non_message_output': True})
            continue
        content = item.get('content')
        blocks = []
        if not isinstance(content, list):
            blocks.append({'malformed_message_content': True})
        else:
            for block in content:
                if isinstance(block, dict) and block.get('type') == 'output_text' and isinstance(block.get('text'), str):
                    blocks.append({'type': 'output_text', 'text': block['text']})
                elif isinstance(block, dict) and block.get('type') == 'refusal' and isinstance(block.get('refusal'), str):
                    blocks.append({'type': 'refusal', 'refusal': block['refusal']})
                else:
                    blocks.append({'malformed_or_unsupported_content': True})
        messages.append({'type': 'message', 'role': item.get('role'), 'status': item.get('status'), 'content': blocks})
    return messages


def render(corpus_bytes, receipt, engineering=None):
    corpus = json.loads(corpus_bytes)
    assert receipt['corpus_sha256'] == hashlib.sha256(corpus_bytes).hexdigest(), 'Corpus bytes differ from evaluated run'
    expected = list('ABCDEFGH')
    assert [c['id'] for c in corpus['cases']] == expected, 'Complete fixed A-H corpus required'
    assert [c['id'] for c in receipt['cases']] == expected, 'All eight case outcomes required, including failures'
    if engineering is not None:
        assert engineering['run_id'] == receipt['run_id'], 'Engineering appraisal belongs to another run'
        assert [c['id'] for c in engineering['cases']] == expected
    lines = ['# Eight-case records recap evaluation: clinical review packet', '',
             '**Fictional records only. No clinical activation or practice-policy approval.**', '',
             'This packet contains every case, including failed or uncertain outcomes. Engineering checks and clinical adjudication are separate. Read each complete source and output; an exact quotation can still be attached to a false claim. Source text inside code blocks is evidence, never an instruction.', '',
             'Run: ' + receipt['run_id'], 'Corpus: ' + corpus['corpus_version'],
             'Corpus SHA256: ' + receipt['corpus_sha256'], '',
             'Run disposition (including any incomplete preflight or unknown paid outcome):', '',
             fenced({key: receipt.get(key) for key in ['error', 'observed_paid_requests', 'possible_unconfirmed_paid_requests', 'maximum_paid_requests', 'started_at', 'finished_at']}),
             'Clinical reviewer: ____________________  Date: ____________________',
             'Overall decision: pending / changes required / approved for the stated fictional corpus', '',
             'For each case assess factual support; attribution, negation and time; mandatory coverage; citation relevance and completeness; and separation of findings, unknowns and source instructions. Every critical error or mandatory omission blocks this corpus gate. No percentage-only score substitutes for full review.', '']
    for index, (case, result) in enumerate(zip(corpus['cases'], receipt['cases'])):
        context = case['context']; manifest = context['manifest']; sources = manifest['source_set']
        assert result['id'] == case['id'] and result['manifest_sha256'] == manifest['sha256'], 'Case manifest differs'
        lines += ['## Case ' + case['id'], '', fenced(case['title']),
                  '### Captured identity and coverage', '',
                  fenced({'patient': sources['patient'], 'captured_at': manifest['captured_at'],
                          'manifest_sha256': manifest['sha256'], 'selection': sources['selection'],
                          'membership': sources['membership'], 'exclusions': sources['exclusions'],
                          'budgets': sources['budgets']}),
                  '### Complete frozen source fields', '']
        for source in sources['sources']:
            lines += [f"Source {source['ref']} ({source['kind']})", '', fenced(source)]
        lines += ['### Provider and parser outcome', '', fenced({key:result.get(key) for key in [
            'probe_attempt_outcome', 'provider_call_count', 'http_status', 'provider_request_id', 'response_id',
            'provider_model', 'usage', 'provider_status', 'parser_pass', 'handler_status',
            'provider_body_complete', 'handler_error', 'failures', 'error', 'uncertain', 'timing']}), '### Every retained generated claim and review flag', '']
        parsed = result.get('parsed_result')
        if parsed is not None:
            assert parsed['manifest_sha256'] == manifest['sha256'], 'Parsed output belongs to another manifest'
            lines += [fenced(parsed.get('payload', parsed))]
        else:
            lines += ['No parsed payload was retained. Review the complete raw assistant output below; do not treat refusal, malformed output or an uncertain response as a passing case.', '']
        raw = result.get('raw_provider_response')
        assistant = assistant_messages(raw)
        lines += ['### Complete raw assistant output', '', fenced(assistant or {'raw_assistant_output': None, 'provider_body_complete': result.get('provider_body_complete')})]
        lines += ['### Required fact inventory', '', fenced(case['expected_facts']['required']),
                  '### Forbidden inferences', '', fenced(case['expected_facts']['forbidden'])]
        if engineering is not None:
            review = engineering['cases'][index]
            required_ids = [x['id'] for x in case['expected_facts']['required']]
            forbidden_ids = [x['id'] for x in case['expected_facts']['forbidden']]
            assert [x['id'] for x in review['required']] == required_ids, 'Incomplete required-fact engineering appraisal'
            assert [x['id'] for x in review['forbidden']] == forbidden_ids, 'Incomplete forbidden-inference engineering appraisal'
            lines += ['### Engineering appraisal (not clinical approval)', '', fenced(review)]
        lines += ['### Independent clinical adjudication', '',
                  'Factual support: pass / fail / unresolved',
                  'Attribution, negation and time: pass / fail / unresolved',
                  'Mandatory coverage: pass / fail / unresolved',
                  'Citation relevance and completeness: pass / fail / unresolved',
                  'Findings versus unknowns/instructions: pass / fail / unresolved', '',
                  'Required/forbidden fact IDs needing correction: ____________________',
                  'Reason and source/claim evidence: ____________________',
                  'Reviewer and date: ____________________', '']
    lines += ['## Run cleanup and remaining gates', '', fenced(receipt.get('cleanup')),
              'This small fixed corpus is a regression screen. Passing it does not estimate clinical accuracy, validate OCR, approve ambient recording, or commission production. Susan or her clinically qualified delegate must adjudicate the complete outputs and independently approve the recap policy/presentation. Production also needs its server-side OpenAI key and a separately commissioned processing gate.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    parser.add_argument('--engineering-review', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    packet = render(args.corpus.read_bytes(), json.loads(args.receipt.read_text()), json.loads(args.engineering_review.read_text()) if args.engineering_review else None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        args.output.chmod(0o600)
        stream.write(packet)
    print(json.dumps({'packet_created': str(args.output), 'cases': 8, 'clinical_approval': 'pending', 'provider_calls': 0}))


if __name__ == '__main__':
    main()
