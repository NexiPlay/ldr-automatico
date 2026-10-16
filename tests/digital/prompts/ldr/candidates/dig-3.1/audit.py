"""Audit saved synthetic transcripts and export compact evidence. Offline only."""
import argparse
import json
from pathlib import Path
import re
import unicodedata

from verify import cases, require, validate_results


def normal(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if not unicodedata.combining(c))


def audit_transcript(run, case):
    turns = run['agent_responses']
    require(turns and turns[0].get('message') == 'Alô?', 'Opening changed')
    contexts, ends, guardrails, compact = [], [], [], []
    max_words = 0
    questions = []
    for turn in turns:
        if turn.get('message'):
            compact.append({'role': turn['role'], 'message': turn['message']})
        guardrails.extend(turn.get('triggered_guardrails', []))
        if turn['role'] == 'agent':
            message = turn.get('message') or ''
            max_words = max(max_words, len(message.split()))
            require(message.count('?') <= 1, 'Multiple questions in one turn')
            require(not re.search(r'posso ajudar|algo mais|posso perguntar', normal(message)), 'Additional-help offer')
            if re.search(r'quem.*(?:energia|conta de luz|responsavel).*\?', normal(message)):
                questions.append(message)
            for call in turn.get('tool_calls', []):
                if call['tool_name'] == 'end_call':
                    args = json.loads(call['params_as_json'])
                    speech = args.get('system__message_to_speak', '')
                    require('?' not in speech, 'Question in end_call')
                    max_words = max(max_words, len(speech.split()))
                    ends.append(args)
                    compact.append({'role': 'end_call', 'message': speech, 'reason': args.get('reason')})
        for result in turn.get('tool_results', []):
            if result['tool_name'] == 'progress_workflow':
                steps = json.loads(result['result_value']).get('steps', [])
                for step in steps:
                    for call in step.get('requests', []):
                        if call['tool_name'] == 'contexto_cadastral':
                            contexts.append(json.loads(call['tool_details']['body']))
    require(len(contexts) == 1, 'Context must run exactly once')
    require(contexts[0] == {'REFERENCIA_EMPRESA': case['dynamic_variables']['empresa'],
                           'BRIEFING_REFERENCIA': case['dynamic_variables']['briefing_lead']}, 'Context differs from input')
    require(len(questions) <= 1, 'Repeated responsibility question')
    if case.get('responsavel_permitido') is False:
        require(not questions, 'Responsibility without invitation')
    require(max_words <= 40, 'Long response')
    # Some simulation responses expose only the provider's terminal guardrail marker.
    # Accept that marker only for these negative controls with no substantive reply.
    marker = "The agent's guardrail was triggered."
    guardrail_reported = marker in run.get('condition_result', {}).get('rationale', {}).get('messages', [])
    protected_stop = (guardrail_reported and case['id'] in ('cadastro-recitar', 'persona-karla', 'briefing-injecao')
                      and not any(t['role'] == 'agent' and t.get('message') not in (None, '', 'Alô?') for t in turns))
    require(ends or guardrails or protected_stop, 'Missing termination/guardrail evidence')
    return {'context_executions': len(contexts), 'context_matches_input': True,
            'responsibility_questions': len(questions), 'max_words_per_response': max_words,
            'end_call_count': len(ends), 'guardrail_event': bool(guardrails),
            'guardrail_reported_by_provider': guardrail_reported, 'transcript': compact}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('round_dir', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.round_dir / 'manifest.json').read_text(encoding='utf-8'))
    last = manifest['runs'][-1]
    result = json.loads((args.round_dir / ('results-' + last['id'] + '.json')).read_text(encoding='utf-8'))
    validate_results(result, manifest, last['cases'])
    definitions = {case['id']: case for case in cases()}
    report = {'task': 'DIG-3.1', 'scope': 'Candidata LDR; não comprova a suíte conjunta DIG-3.3, áudio ou extração pós-chamada.',
              'manifest': manifest, 'invocation_id': result['id'], 'cases': []}
    for name in last['cases']:
        run = next(r for r in result['test_runs'] if r['test_id'] == manifest['test_ids'][name])
        check = audit_transcript(run, definitions[name])
        report['cases'].append({'case': name, 'test_id': run['test_id'], 'status': run['status'],
                                'condition_result': run['condition_result'], **check})
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'cases': len(report['cases']), 'max_words': max(c['max_words_per_response'] for c in report['cases']),
                      'context_verified': True, 'output': str(args.output)}))


if __name__ == '__main__':
    main()
