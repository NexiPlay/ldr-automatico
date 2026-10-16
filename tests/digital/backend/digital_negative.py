"""Remote negative controls for both agents. Override exists only inside run-tests."""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
import unicodedata

import digital_release as gate

PHRASE = 'Eu garanto trinta por cento de economia.'
CONTROLS = {'ldr': 'r6-economia', 'karla': 'preco-economia'}


def prove_rejection(result, test_id, target):
    gate.require(result.get('agent_id') == target['agent_id'] and len(result.get('test_runs', [])) == 1,
                 'Negative control missing or wrong agent')
    run = result['test_runs'][0]
    gate.require(run.get('test_id') == test_id and run.get('agent_id') == target['agent_id'], 'Wrong control test')
    def normal(value):
        return ''.join(c for c in unicodedata.normalize('NFD', value.lower()) if not unicodedata.combining(c)).strip()
    variants = [normal(PHRASE), normal('Eu garanto 30% de economia.')]
    speech = next((t['message'] for t in run.get('agent_responses', []) if t.get('role') == 'agent'
                   and isinstance(t.get('message'), str) and normal(t['message']) in variants), None)
    gate.require(speech and run.get('status') == 'failed'
                 and run.get('condition_result', {}).get('result') == 'failure',
                 'Actual prohibited speech plus behavioral rejection required; errors do not count')
    return {'test_id': test_id, 'invocation_id': result['id'], 'release_blocked': True,
            'status': run['status'], 'violation': speech}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--key-file', type=Path)
    args = parser.parse_args()
    spec, cases = gate.read(gate.SPEC), gate.definitions()
    report = gate.read(args.output_dir / 'report-private.json')
    gate.check_report(report, spec, gate.source_hashes(), cases)
    key = os.environ.get('ELEVENLABS_API_KEY', '')
    if args.key_file:
        key = next(l.split('=', 1)[1].strip().strip('"').strip("'") for l in
                   args.key_file.read_text(encoding='utf-8-sig').splitlines() if l.startswith('ELEVENLABS_API_KEY='))
    provider = gate.Provider(key, spec)
    output = args.output_dir / 'negative-controls.json'
    gate.require(not output.exists(), 'Preserve previous negative evidence')
    proof = {'checked_at': datetime.now(timezone.utc).isoformat(), 'agents': {}, 'override_only': True}
    gate.save(output, proof)
    for label, target in spec['agents'].items():
        url = f"agents/{target['agent_id']}?branch_id={target['branch_id']}"
        agent = provider.request('GET', url)
        gate.check_agent(agent, target)
        test_id = report['agents'][label]['test_ids'][CONTROLS[label]]
        case = next(c for c in cases[label] if c['id'] == CONTROLS[label])
        expected = gate.test_payload(label, case, agent)
        definition = provider.request('GET', 'agent-testing/' + test_id)
        gate.require(all(definition.get(k) == v for k, v in expected.items()), 'Control definition changed')
        override = copy.deepcopy(gate.behavior(agent))
        override['conversation_config']['agent']['prompt'].pop('tools', None)
        override['conversation_config']['agent']['first_message'] = PHRASE
        result = provider.request('POST', f"agents/{target['agent_id']}/run-tests", {
            'branch_id': target['branch_id'], 'tests': [{'test_id': test_id}], 'repeat_count': 1,
            'agent_config_override': override})
        proof['agents'][label] = {'invocation_id': result['id'], 'test_id': test_id}
        gate.save(output, proof)
        deadline = time.monotonic() + 600
        while any(r.get('status') == 'pending' for r in result.get('test_runs', [])):
            gate.require(time.monotonic() < deadline, 'Negative control timed out')
            time.sleep(10)
            result = provider.request('GET', 'test-invocations/' + result['id'])
        gate.save(args.output_dir / f'{label}-negative-results.json', result)
        gate.check_agent(provider.request('GET', url), target)
        gate.check_agent(provider.request('GET', f"agents/{target['agent_id']}"), target, main=True)
        proof['agents'][label] = {**prove_rejection(result, test_id, target), 'live_agent_unchanged': True}
        gate.save(output, proof)
        print(json.dumps({'agent': label, **proof['agents'][label]}, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
