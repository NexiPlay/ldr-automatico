"""Negative controls for the joint release evidence; all network access mocked."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('digital_release', Path(__file__).resolve().parents[1] / 'digital_release.py')
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


class DigitalReleaseTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.spec = {'agents': {label: {'agent_id': label, 'version_id': label + '-version',
                                      'branch_id': label + '-branch'} for label in ('ldr', 'karla')}}
        self.cases = {label: [{'id': 'a'}, {'id': 'b'}] for label in self.spec['agents']}
        self.report = {'spec_sha256': gate.digest(self.spec), 'sources': {'file': 'hash'},
                       'checked_at': self.now.isoformat(), 'agents': {}}
        for label, target in self.spec['agents'].items():
            runs = [{**target, 'test_id': f'{label}-{name}', 'test_invocation_id': label + '-suite',
                     'ran_against_draft': False, 'status': 'passed', 'condition_result': {'result': 'success'},
                     'agent_responses': [{'role': 'agent', 'message': 'Alô?'}]} for name in ('a', 'b')]
            self.report['agents'][label] = {'test_ids': {name: f'{label}-{name}' for name in ('a', 'b')},
                'result': {**target, 'id': label + '-suite', 'repeat_count': 1, 'cancelled': False,
                           'ran_against_draft': False, 'test_runs': runs}, 'audited': True}

    def check(self, report):
        return gate.check_report(report, self.spec, {'file': 'hash'}, self.cases, now=self.now)

    def test_requires_both_agents_and_current_sources(self):
        self.assertTrue(self.check(self.report))
        variants = []
        for label in self.spec['agents']:
            report = copy.deepcopy(self.report)
            del report['agents'][label]
            variants.append(report)
        for field, value in [('sources', {'file': 'changed'}), ('spec_sha256', 'changed')]:
            variants.append({**self.report, field: value})
        for report in variants:
            with self.subTest(report=report), self.assertRaises(ValueError):
                self.check(report)

    def test_rejects_missing_duplicate_extra_or_unreviewed_results(self):
        for label in self.spec['agents']:
            for defect in ('missing', 'duplicate', 'extra', 'reused_id', 'unreviewed'):
                report = copy.deepcopy(self.report)
                item = report['agents'][label]
                runs = item['result']['test_runs']
                if defect == 'missing': runs.pop()
                if defect == 'duplicate': runs[1] = copy.deepcopy(runs[0])
                if defect == 'extra': runs.append(copy.deepcopy(runs[0]))
                if defect == 'reused_id': item['test_ids']['b'] = item['test_ids']['a']
                if defect == 'unreviewed': item['audited'] = False
                with self.subTest(label=label, defect=defect), self.assertRaises(ValueError):
                    self.check(report)

    def test_one_failed_inconclusive_pending_or_empty_case_blocks_joint_release(self):
        for label in self.spec['agents']:
            for field, value in [('status', 'failed'), ('status', 'pending'),
                                 ('condition_result', {'result': 'unknown'}), ('agent_responses', [])]:
                report = copy.deepcopy(self.report)
                report['agents'][label]['result']['test_runs'][0][field] = value
                with self.subTest(label=label, field=field, value=value), self.assertRaises(ValueError):
                    self.check(report)

    def test_simulator_cannot_replace_recording_with_a_human_complaint(self):
        self.cases['ldr'][0]['required_user_message'] = 'Aviso técnico fixo.'
        run = self.report['agents']['ldr']['result']['test_runs'][0]
        run['agent_responses'].append({'role': 'user', 'message': 'Estou com problema na ligação.'})
        with self.assertRaisesRegex(ValueError, 'Simulator'): self.check(self.report)
        run['agent_responses'][-1]['message'] = 'Aviso técnico fixo.'
        self.assertTrue(self.check(self.report))

    def test_simulator_cannot_invert_receptionist_and_caller(self):
        expected = 'Oficina Horizonte, sou da recepção, em que posso ajudar?'
        self.cases['ldr'][0]['required_first_user_message'] = expected
        run = self.report['agents']['ldr']['result']['test_runs'][0]
        run['agent_responses'].append({'role': 'user', 'message': 'Quem cuida da energia aí?'
                                      })
        with self.assertRaisesRegex(ValueError, 'receptionist'): self.check(self.report)
        run['agent_responses'][-1]['message'] = expected
        run['agent_responses'].append({'role': 'user', 'message': 'Carlos.'})
        self.assertTrue(self.check(self.report))

    def test_mixed_versions_branches_suites_and_drafts_are_rejected(self):
        for level in ('invocation', 'run'):
            for field, value in [('agent_id', 'other'), ('version_id', 'other'), ('branch_id', 'other'),
                                 ('ran_against_draft', True)]:
                report = copy.deepcopy(self.report)
                target = report['agents']['ldr']['result']
                if level == 'run': target = target['test_runs'][0]
                target[field] = value
                with self.subTest(level=level, field=field), self.assertRaises(ValueError):
                    self.check(report)
        report = copy.deepcopy(self.report)
        report['agents']['karla']['result']['test_runs'][0]['test_invocation_id'] = 'older-suite'
        with self.assertRaises(ValueError): self.check(report)

    def test_expired_and_future_evidence_is_rejected(self):
        for delta in (-1801, 1):
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                self.check({**self.report, 'checked_at': (self.now + timedelta(seconds=delta)).isoformat()})

    def test_live_drift_in_prompt_voice_workflow_and_collection_blocks(self):
        agent = {'agent_id': 'a', 'version_id': 'v', 'conversation_config': {'voice': 'original'},
                 'workflow': {'step': 'original'}, 'platform_settings': {'collection': 'original'}}
        target = {'agent_id': 'a', 'version_id': 'v', 'behavior_sha256': gate.digest(gate.behavior(agent))}
        gate.check_agent(agent, target)
        for key in ('version_id', 'conversation_config', 'workflow', 'platform_settings'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                gate.check_agent({**agent, key: 'changed'}, target)

    def test_test_runner_cannot_dial_publish_or_modify_agents(self):
        provider = gate.Provider('test-only', self.spec)
        with patch.object(gate, 'urlopen', side_effect=AssertionError('Network must not be reached')):
            for method, path in [('POST', 'sip-trunk/outbound-call'), ('POST', 'twilio/outbound-call'),
                                 ('POST', 'agents/ldr/deployments'), ('PATCH', 'agents/ldr'),
                                 ('POST', 'agents/ldr/branches'), ('GET', 'agents/another'),
                                 ('GET', 'test-invocations/../agents')]:
                with self.subTest(path=path), self.assertRaises(ValueError): provider.request(method, path)

    def test_karla_question_cannot_be_hidden_in_end_call(self):
        agent = {'conversation_config': {'agent': {'first_message': 'Opening'}}}
        run = {'agent_responses': [{'role': 'agent', 'message': 'Opening', 'tool_calls': [
            {'tool_name': 'end_call', 'params_as_json': '{"system__message_to_speak":"Posso ajudar?"}'}]}]}
        with self.assertRaises(ValueError): gate.audit_karla(run, {'id': 'ordinary'}, agent)

    def test_non_injection_cannot_use_guardrail_as_success(self):
        agent = {'conversation_config': {'agent': {'first_message': 'Opening'}}}
        run = {'agent_responses': [{'role': 'agent', 'message': 'Opening'}],
               'condition_result': {'rationale': {'messages': ["The agent's guardrail was triggered."]}}}
        gate.audit_karla(run, {'id': 'injecao-e-dados-internos'}, agent)
        with self.assertRaises(ValueError): gate.audit_karla(run, {'id': 'ordinary'}, agent)

    def test_negative_control_requires_prohibited_agent_speech_and_actual_failure(self):
        with patch.dict(sys.modules, {'digital_release': gate}):
            negative = gate.load_module('digital_negative', 'backend/digital_negative.py')
        run = {'agent_id':'a', 'test_id':'t', 'status':'failed', 'condition_result':{'result':'failure'},
               'agent_responses':[{'role':'agent', 'message':negative.PHRASE}]}
        result = {'agent_id':'a', 'id':'suite', 'test_runs':[run]}
        self.assertTrue(negative.prove_rejection(result, 't', {'agent_id':'a'})['release_blocked'])
        for changes in [{'status':'error'}, {'status':'passed'}, {'agent_responses':[]},
                        {'agent_responses':[{'role':'user', 'message':negative.PHRASE}]},
                        {'agent_responses':[{'role':'agent', 'message':'Não posso garantir economia.'}]}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                negative.prove_rejection({**result, 'test_runs':[{**run, **changes}]}, 't', {'agent_id':'a'})


if __name__ == '__main__':
    unittest.main()
