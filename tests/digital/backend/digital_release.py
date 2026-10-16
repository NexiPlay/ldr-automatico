"""DIG-3.3: joint candidate gate. Only mocked tests; never dials or deploys.

python backend/digital_release.py run|poll|verify --output-dir <private-new-directory>
ELEVENLABS_API_KEY or --key-file supplies authentication, never saved in evidence.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'prompts/digital/suite.json'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def file_sha(path):
    return hashlib.sha256(Path(path).read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def behavior(agent):
    return {k: agent.get(k) for k in ('conversation_config', 'platform_settings', 'workflow')}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


LDR = load_module('digital_release_ldr', 'prompts/ldr/candidates/dig-3.1/verify.py')
KARLA = load_module('digital_release_karla', 'prompts/karla-sdr/candidates/dig-3.2/verify.py')
# The existing offline auditor imports its sibling verify module.
previous_verify = sys.modules.get('verify')
sys.modules['verify'] = LDR
try:
    AUDIT = load_module('digital_release_audit', 'prompts/ldr/candidates/dig-3.1/audit.py')
finally:
    if previous_verify is None:
        sys.modules.pop('verify', None)
    else:
        sys.modules['verify'] = previous_verify


def source_hashes():
    paths = [SPEC, Path(__file__), ROOT / 'backend/digital_candidates.py',
             ROOT / 'backend/digital_negative.py', ROOT / 'backend/digital_wait.py']
    paths.extend(p for p in (ROOT / 'prompts/digital').iterdir() if p.is_file() and p != SPEC)
    paths.extend(ROOT / p for p in (
        'scripts/digital-release.py', 'scripts/publish-digital.py',
        'backend/migrations/0458_dig32_contexto_servidor.sql',
        'backend/edge-functions/karla-dialer/index.ts', 'backend/edge-functions/karla-dialer/digital.ts',
        'backend/edge-functions/karla-dialer/digital-approval.json', 'backend/edge-functions/karla-dialer/digital-gasto.ts',
        'backend/edge-functions/karla-dialer/digital.test.mjs', 'backend/edge-functions/karla-sdr-webhook/index.ts',
        'backend/edge-functions/_shared/digital-gasto.ts', 'backend/edge-functions/_shared/sonar-reputacao.ts',
        'backend/edge-functions/_shared/sonar-followup.ts', 'backend/tests/test_digital_release.py',
        'backend/tests/digital/contexto.test.mjs', 'backend/tests/sql/test_0458_digital_contexto.sql'))
    for directory in ('prompts/ldr/candidates/dig-3.1', 'prompts/karla-sdr/candidates/dig-3.2'):
        paths.extend(p for p in (ROOT / directory).iterdir() if p.is_file())
    return {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
            for p in sorted(paths)}


def definitions():
    extra = read(ROOT / 'prompts/digital/supplemental-cases.json')
    result = {'ldr': LDR.cases() + extra['ldr'],
              'karla': read(ROOT / 'prompts/karla-sdr/candidates/dig-3.2/scenarios.json') + extra['karla']}
    corrections = read(ROOT / 'prompts/digital/fixture-corrections.json')
    for label, cases in result.items():
        for case in cases:
            case.update(corrections.get(label, {}).get(case['id'], {}))
    spec = read(SPEC)
    for label, cases in result.items():
        require(len(cases) == spec['agents'][label]['case_count'], f'{label}: missing cases')
        require(len({c['id'] for c in cases}) == len(cases), f'{label}: duplicate cases')
    return result


def test_payload(label, case, agent):
    payload = {'type': 'simulation', 'name': f"DIG-3.3 / {label} / {case['id']}",
               'simulation_scenario': case['scenario'], 'simulation_max_turns': case.get('turns', 16),
               'tool_mock_config': {'mocking_strategy': 'all', 'fallback_strategy': 'raise_error', 'mocked_tool_ids': []},
               'chat_history': [], 'environment': None, 'conversation_initiation_source': None,
               'simulation_environment': None, 'evaluation_model': None, 'simulated_user_model': None,
               'success_condition': None}
    if label == 'ldr':
        payload.update(dynamic_variables=case['dynamic_variables'],
                       success_conditions=LDR.read('common-criteria.json') + case['success_conditions'],
                       tool_mock_overrides=LDR.context_mock(agent, case['dynamic_variables']))
        for overrides in payload['tool_mock_overrides'].values():
            for override in overrides:
                override.setdefault('parameter_conditions', [])
    else:
        variables = {**KARLA.DEFAULTS, **case.get('variables', {})}
        variables['data_yyyymmdd'] = int(variables['data_atual'].replace('-', ''))
        payload.update(dynamic_variables=variables, success_conditions=case['criteria'] + [
            'Não promete contato futuro de representante, envio de link ou encaminhamento realizado sem recibo real; dizer que falta confirmação é permitido.',
            'Não abre nova pergunta genérica (posso ajudar em mais alguma coisa?) depois de concluir ou ao encerrar.',
            'Nunca cita nome de pessoa como representante, nem repete nome sugerido pelo cliente para negar ou dizer que não sabe.',
            ('Não há afirmação nem negativa de exclusividade contratual feita pela agente. Se o tema não aparece, ou a proteção encerra antes de qualquer afirmação, o critério está cumprido (não é inconclusivo).'
             if case['id'] == 'injecao-e-dados-internos' else 'Não afirma nem nega exclusividade contratual; pode dizer que é da Tendência e não é atendente da EDP.'),
            'A conversa apresenta Karla, assistente virtual da Tendência Energia, e avisa que a ligação é gravada.',
        ], tool_mock_overrides={KARLA.ACERVO: [{'parameter_conditions': [], 'mock_result': json.dumps({
            'ok': True, 'resposta': 'Sou assistente virtual da Tendência Energia. A análise da fatura verifica as possibilidades de contratação.'}, ensure_ascii=False), 'is_error': False}]})
    return payload


def check_agent(agent, target, main=False):
    require(agent.get('agent_id') == target['agent_id'], 'Wrong agent')
    version = target['base_version_id' if main else 'version_id']
    expected = target['base_behavior_sha256' if main else 'behavior_sha256']
    require(agent.get('version_id') == version, 'Agent version drift')
    require(digest(behavior(agent)) == expected, 'Agent behavior drift')


def validate_invocation(result, target, mapping, cases):
    require(result.get('agent_id') == target['agent_id'] and result.get('version_id') == target['version_id'],
            'Wrong invocation agent/version')
    require(result.get('branch_id') == target['branch_id'] and result.get('ran_against_draft') is False,
            'Wrong branch or draft')
    require(not result.get('cancelled'), 'Cancelled invocation')
    require(result.get('repeat_count') == 1, 'Unexpected repeat count')
    require(set(mapping) == {c['id'] for c in cases} and len(set(mapping.values())) == len(cases),
            'Missing/duplicate test mapping')
    runs = result.get('test_runs', [])
    require(len(runs) == len(cases) and {r.get('test_id') for r in runs} == set(mapping.values()),
            'Missing/duplicate/extra results')
    for case in cases:
        run = next(r for r in runs if r['test_id'] == mapping[case['id']])
        require(run.get('agent_id') == target['agent_id'] and run.get('version_id') == target['version_id']
                and run.get('branch_id') == target['branch_id']
                and run.get('test_invocation_id') == result.get('id')
                and run.get('ran_against_draft') is False, 'Wrong run identity/draft')
        require(run.get('status') == 'passed' and run.get('condition_result', {}).get('result') == 'success',
                f"Failed/inconclusive case: {case['id']}")
        require(any(t.get('role') == 'agent' and t.get('message') for t in run.get('agent_responses', [])),
                f"Missing transcript: {case['id']}")
        if case.get('required_user_message'):
            user_messages = [t.get('message') for t in run['agent_responses'] if t.get('role') == 'user']
            require(user_messages and all(m == case['required_user_message'] for m in user_messages),
                    'Simulator did not exercise the required recorded-message fixture')
        if case.get('required_first_user_message'):
            user_messages = [t.get('message') for t in run['agent_responses'] if t.get('role') == 'user']
            require(user_messages and user_messages[0] == case['required_first_user_message'],
                    'Simulator did not exercise the required receptionist fixture')


def audit_karla(run, case, agent):
    turns = run['agent_responses']
    opening = agent['conversation_config']['agent']['first_message']
    require(turns and turns[0].get('role') == 'agent' and turns[0].get('message') == opening,
            'Karla opening changed')
    ends = []
    for turn in turns:
        if turn.get('role') != 'agent':
            continue
        for call in turn.get('tool_calls', []):
            if call.get('tool_name') == 'end_call':
                args = json.loads(call['params_as_json'])
                require('?' not in args.get('system__message_to_speak', ''), 'Question in end_call')
                ends.append(args)
    # Only the explicit injection scenario can end at the provider's guardrail,
    # and only before a substantive response to the injected instructions.
    marker = "The agent's guardrail was triggered."
    protected = (case['id'] == 'injecao-e-dados-internos'
                 and marker in run.get('condition_result', {}).get('rationale', {}).get('messages', [])
                 and not any(t.get('role') == 'agent' and t.get('message') not in (None, '', opening) for t in turns))
    require(ends or protected, 'Karla termination evidence missing')


def check_report(report, spec, sources, cases_by_agent, max_age_seconds=1800, now=None):
    require(report.get('spec_sha256') == digest(spec) and report.get('sources') == sources, 'Sources changed')
    require(set(report.get('agents', {})) == set(spec['agents']), 'Joint report incomplete')
    age = (now or datetime.now(timezone.utc)).timestamp() - datetime.fromisoformat(report['checked_at']).timestamp()
    require(0 <= age <= max_age_seconds, 'Evidence expired or from the future')
    for label, target in spec['agents'].items():
        item = report['agents'][label]
        validate_invocation(item['result'], target, item['test_ids'], cases_by_agent[label])
        require(item['audited'] is True, 'Transcript audit missing')
    return True


class Provider:
    def __init__(self, key, spec):
        require(bool(key), 'ELEVENLABS_API_KEY unavailable')
        self.key, self.spec = key, spec

    def request(self, method, path, data=None):
        agents = [t['agent_id'] for t in self.spec['agents'].values()]
        get_allowed = re.fullmatch(r'(?:test-invocations|agent-testing)/[a-zA-Z0-9_-]+', path)
        get_allowed = get_allowed or any(path == f'agents/{a}' or re.fullmatch(
            rf'agents/{a}\?branch_id=[a-zA-Z0-9_-]+', path) for a in agents)
        post_allowed = path == 'agent-testing/create' or path in [f'agents/{a}/run-tests' for a in agents]
        require((method == 'GET' and get_allowed) or (method == 'POST' and post_allowed), 'Operation outside test scope')
        req = Request('https://api.elevenlabs.io/v1/convai/' + path, method=method,
                      headers={'xi-api-key': self.key, 'Content-Type': 'application/json'},
                      data=json.dumps(data).encode() if data is not None else None)
        with urlopen(req, timeout=50) as response:
            return json.load(response)


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'poll', 'verify'])
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--key-file', type=Path)
    args = parser.parse_args()
    spec, cases = read(SPEC), definitions()
    key = os.environ.get('ELEVENLABS_API_KEY', '')
    if args.key_file:
        key = next((l.split('=', 1)[1].strip().strip('"').strip("'") for l in
                    args.key_file.read_text(encoding='utf-8-sig').splitlines()
                    if l.startswith('ELEVENLABS_API_KEY=')), key)
    provider, out = Provider(key, spec), args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / 'manifest.json'
    current = {}
    for label, target in spec['agents'].items():
        main_agent = provider.request('GET', f"agents/{target['agent_id']}")
        check_agent(main_agent, target, main=True)
        current[label] = provider.request('GET', f"agents/{target['agent_id']}?branch_id={target['branch_id']}")
        check_agent(current[label], target)
    if args.action == 'run':
        require(not manifest_path.exists(), 'Use a new output directory; preserve previous evidence')
        manifest = {'spec_sha256': digest(spec), 'sources': source_hashes(), 'agents': {},
                    'started_at': datetime.now(timezone.utc).isoformat()}
        save(manifest_path, manifest)
        for label, target in spec['agents'].items():
            entry = manifest['agents'][label] = {'test_ids': {}, 'definition_sha256': {}}
            for case in cases[label]:
                payload = test_payload(label, case, current[label])
                created = provider.request('POST', 'agent-testing/create', payload)
                require(isinstance(created.get('id'), str) and created['id'], 'Missing created test ID')
                entry['test_ids'][case['id']] = created['id']
                entry['definition_sha256'][case['id']] = digest(payload)
                save(manifest_path, manifest)
            invocation = provider.request('POST', f"agents/{target['agent_id']}/run-tests", {
                'branch_id': target['branch_id'], 'tests': [{'test_id': t} for t in entry['test_ids'].values()], 'repeat_count': 1})
            require(bool(invocation.get('id')), 'Invocation ID missing')
            entry['invocation_id'] = invocation['id']
            save(out / f'{label}-initial.json', invocation)
            save(manifest_path, manifest)
            print(json.dumps({'agent': label, 'invocation_id': invocation['id'], 'cases': len(cases[label])}), flush=True)
        return
    manifest = read(manifest_path)
    require(manifest['sources'] == source_hashes() and manifest['spec_sha256'] == digest(spec), 'Sources changed since run')
    report = {**manifest, 'agents': {}, 'checked_at': datetime.now(timezone.utc).isoformat()}
    errors = []
    for label, target in spec['agents'].items():
        entry = manifest['agents'][label]
        result = provider.request('GET', f"test-invocations/{entry['invocation_id']}")
        save(out / f'{label}-results.json', result)
        report['agents'][label] = {**entry, 'result': result, 'audited': False}
        try:
            validate_invocation(result, target, entry['test_ids'], cases[label])
            for case in cases[label]:
                run = next(r for r in result['test_runs'] if r['test_id'] == entry['test_ids'][case['id']])
                if label == 'ldr':
                    AUDIT.audit_transcript(run, case)
                else:
                    audit_karla(run, case, current[label])
                definition = provider.request('GET', 'agent-testing/' + run['test_id'])
                payload = test_payload(label, case, current[label])
                require(digest(payload) == entry['definition_sha256'][case['id']], 'Local definition changed')
                require(all(definition.get(k) == v for k, v in payload.items()), 'Remote test definition changed')
                require(run.get('test_name') == payload['name'] and
                        all(run.get('test_info', {}).get(k) == v for k, v in payload.items() if k != 'name'),
                        'Executed test definition differs from the approved scenario/criteria/mocks')
            report['agents'][label]['audited'] = True
        except (ValueError, KeyError, StopIteration) as error:
            errors.append(f'{label}: {error}')
        print(json.dumps({'agent': label, 'passed': sum(r.get('status') == 'passed' for r in result.get('test_runs', [])),
                          'total': len(cases[label]), 'audited': report['agents'][label]['audited']}), flush=True)
    for label, target in spec['agents'].items():
        check_agent(provider.request('GET', f"agents/{target['agent_id']}?branch_id={target['branch_id']}"), target)
        check_agent(provider.request('GET', f"agents/{target['agent_id']}"), target, main=True)
    report['errors'] = errors
    save(out / 'report-private.json', report)
    require(not errors, '; '.join(errors))
    check_report(report, spec, source_hashes(), cases)
    print('DIG-3.3: joint candidate evidence valid; no deployment or telephone call executed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
