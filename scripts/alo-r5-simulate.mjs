// Candidate branch only. Never activates an agent or places a call.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkLocal, commonCriteria, behaviorDigest, assertTestResults } from './ldr-release.mjs';
import { assertApprovedAgent, sha256 } from '../backend/edge-functions/_shared/ldr-policy.mjs';
import approval from '../backend/edge-functions/_shared/ldr-approval.json' with { type: 'json' };
import cases from '../tests/adversarial/cases.json' with { type: 'json' };
import { assertTranscriptPolicy } from './ldr-transcript.mjs';

const [mode, folder, baselineFile] = process.argv.slice(2);
if (!['stage', 'run', 'status', 'retry-infrastructure'].includes(mode) || !folder || !baselineFile || !process.env.ELEVENLABS_API_KEY)
  throw new Error('Uso: alo-r5-simulate.mjs stage|run|status|retry-infrastructure pasta-privada snapshot-base.json');
await mkdir(folder, { recursive: true });
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const save = (name, value) => writeFile(resolve(folder, name + '.json'), JSON.stringify(value, null, 2) + '\n');
async function api(path, body) {
  const response = await fetch('https://api.elevenlabs.io/v1/convai/' + path, {
    method: body ? 'POST' : 'GET', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    await writeFile(resolve(folder, 'provider-error.txt'), await response.text());
    throw new Error('ElevenLabs HTTP ' + response.status + '; detalhe privado');
  }
  return response.json();
}
const source = await json(baselineFile), base = source.data || source;
const path = 'agents/' + approval.agent_id;
const fingerprint = value => behaviorDigest({ ...value, version_id: undefined });
async function assertBase() {
  const live = await api(path);
  if (live.agent_id !== base.agent_id || await behaviorDigest(live) !== await behaviorDigest(base))
    throw new Error('Agente ativo mudou desde a auditoria');
  return live;
}
const live = await assertBase();
const { prompt, firstMessage } = await checkLocal();
const opening = await json(new URL('../prompts/bruno/opening-config.json', import.meta.url));
const expected = structuredClone(live), config = expected.conversation_config;
config.agent.prompt.prompt = prompt;
config.agent.prompt.llm = opening.llm;
config.agent.first_message = firstMessage.trim();
if (!config.agent.prompt.built_in_tools?.end_call) throw new Error('end_call ausente');
config.agent.prompt.built_in_tools.end_call.description = opening.end_call_description;
config.agent.prompt.built_in_tools.end_call.pre_tool_speech = opening.end_call_pre_tool_speech;
for (const tool of config.agent.prompt.tools || [])
  if (tool.type === 'system' && tool.name === 'end_call') {
    tool.description = opening.end_call_description;
    tool.pre_tool_speech = opening.end_call_pre_tool_speech;
  }
const writable = value => {
  const copy = structuredClone(value);
  if (copy.agent.prompt.tool_ids?.length) delete copy.agent.prompt.tools;
  return copy;
};
await save('prepared', { base_version_id: base.version_id, base_behavior_sha256: await behaviorDigest(base), approval,
  patch: { conversation_config: writable(config), version_description: approval.version },
  rollback: { conversation_config: writable(base.conversation_config), version_description: 'Rollback abertura Alô' },
  expected_behavior_sha256: await fingerprint(expected) });
async function assertCandidate(branchId) {
  const candidate = await api(path + '?branch_id=' + encodeURIComponent(branchId));
  await assertApprovedAgent(candidate, approval);
  if (await fingerprint(candidate) !== await fingerprint(expected)) throw new Error('Configuração candidata divergente');
  return candidate;
}
if (mode === 'stage') {
  const name = approval.version + ' ' + (await fingerprint(expected)).slice(0, 12);
  const list = await api(path + '/branches');
  const exists = (list.results || list.branches || []).find(b => b.name === name);
  let branchId = exists?.id || exists?.branch_id;
  if (!branchId) {
    const created = await api(path + '/branches', { parent_version_id: base.version_id, name,
      description: 'Alô com R5 na primeira resposta; simulação sem tráfego',
      conversation_config: writable(config), workflow: live.workflow, include_draft: false });
    await save('branch-created', created);
    branchId = created.created_branch_id || created.branch_id || created.id;
  }
  if (!branchId) throw new Error('Branch ID ausente');
  const candidate = await assertCandidate(branchId);
  await save('agent-staged', candidate); await assertBase();
  const stage = { branch_id: branchId, version_id: candidate.version_id, behavior_sha256: await behaviorDigest(candidate),
    approval, main_unchanged: true };
  await save('stage', stage); console.log(JSON.stringify(stage));
} else {
  const stage = await json(resolve(folder, 'stage.json'));
  const candidate = await assertCandidate(stage.branch_id);
  if (candidate.version_id !== stage.version_id) throw new Error('Versão candidata mudou');
  const casesHash = await sha256(JSON.stringify({ cases, commonCriteria }));
  if (mode === 'run') {
    const ids = [];
    for (const item of cases) {
      const created = await api('agent-testing/create', { type: 'simulation', name: approval.version + '/' + item.id,
        simulation_scenario: item.scenario, simulation_max_turns: 10, dynamic_variables: item.dynamic_variables,
        success_conditions: [...commonCriteria, ...item.success_conditions],
        tool_mock_config: { mocking_strategy: 'all', fallback_strategy: 'raise_error' } });
      if (!created.id) throw new Error('ID de teste ausente');
      ids.push(created.id); await save('registered-tests', { ids, cases: cases.slice(0, ids.length).map(c => c.id) });
    }
    const invocation = await api(path + '/run-tests', { branch_id: stage.branch_id, tests: ids.map(test_id => ({ test_id })), repeat_count: 1 });
    if (!invocation.id) throw new Error('ID de execução ausente');
    await save('run', { invocation_id: invocation.id, ids, cases_sha256: casesHash, stage });
    console.log(JSON.stringify({ invocation_id: invocation.id, cases: ids.length, all_tools_mocked: true }));
  } else {
    const run = await json(resolve(folder, 'run.json'));
    if (run.cases_sha256 !== casesHash || JSON.stringify(run.stage) !== JSON.stringify(stage)) throw new Error('Artefatos mudaram');
    const invocation = await api('test-invocations/' + run.invocation_id);
    await save('results', { checked_at: new Date().toISOString(), run, invocation }); await assertBase();
    const counts = {};
    for (const test of invocation.test_runs || []) counts[test.status] = (counts[test.status] || 0) + 1;
    console.log(JSON.stringify({ counts, main_unchanged: true }));
    if (mode === 'retry-infrastructure') {
      const failed = invocation.test_runs.filter(t => t.status === 'failed');
      if (counts.pending || counts.running || !failed.length || failed.some(t =>
        !t.condition_result?.rationale?.messages?.some(m => /Insufficient credits|all LLM attempts were exhausted|LLM did not produce output in time/.test(m))))
        throw new Error('Retry restrito a falha explícita de infraestrutura; comportamento exige revisão');
      await save('before-infrastructure-retry-' + Date.now(), { run, invocation });
      await api('test-invocations/' + run.invocation_id + '/resubmit', {
        test_run_ids: failed.map(t => t.test_run_id), agent_id: approval.agent_id, branch_id: stage.branch_id,
      });
      console.log(JSON.stringify({ resubmitted: failed.length, main_unchanged: true }));
      process.exit(0);
    }
    if (!invocation.test_runs.some(t => ['pending', 'running'].includes(t.status))) {
      assertTestResults(invocation, run.ids, approval.agent_id, stage.version_id);
      cases.forEach((item, i) => assertTranscriptPolicy(invocation.test_runs.find(r => r.test_id === run.ids[i]).agent_responses, item));
    }
  }
}
