// Homologação com entrada textual: sem telefone, deploy ou alteração do agente.
// node validate-collection.mjs --key-file <env> --output-dir <diretorio privado>
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { blockedRegionFailures, blockedRegionReply, completionFailures } from './collection-checks.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
assert(args.includes('--output-dir'), '--output-dir obrigatório (resultados privados)');
const out = resolve(option('--output-dir'));
mkdirSync(out, { recursive: true });
let key = process.env.ELEVENLABS_API_KEY;
if (args.includes('--key-file')) {
  key = readFileSync(option('--key-file'), 'utf8').split(/\r?\n/)
    .find(l => l.startsWith('ELEVENLABS_API_KEY='))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}
assert(key, 'ELEVENLABS_API_KEY ausente');
const evidence = JSON.parse(readFileSync(args.includes('--manifest') ? option('--manifest') : resolve(root, '../../../../documentacao/projetos/digital/qa-dig-3.2-warley-2026-10-16.json'), 'utf8'));
const { agent_id: agent, branch_id: branch, version_id: version } = evidence;
const schema = JSON.parse(readFileSync(join(root, 'data-collection.json'), 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
async function get(path) {
  const response = await fetch('https://api.elevenlabs.io/v1/convai/' + path, {
    headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(25_000),
  });
  assert(response.ok, `ElevenLabs HTTP ${response.status}`);
  return response.json();
}
const main = await get(`agents/${agent}`);
const candidate = await get(`agents/${agent}?branch_id=${branch}`);
assert.equal(candidate.version_id, version, 'Candidata mudou: repetir QA antes de homologar');
assert.equal(candidate.conversation_config.agent.prompt.prompt, readFileSync(join(root, 'system.md'), 'utf8').replace(/\r\n/g, '\n'));
assert.deepEqual(Object.keys(candidate.platform_settings.data_collection).sort(), Object.keys(schema).sort());
for (const [field, expected] of Object.entries(schema)) {
  const actual = candidate.platform_settings.data_collection[field];
  for (const [k, value] of Object.entries(expected)) assert.deepEqual(actual[k], value, `${field}.${k}`);
  assert.equal(actual.is_system_provided, false);
  assert.equal(actual.is_omitted, false);
}
assert.equal(candidate.platform_settings.overrides.conversation_config_override.conversation.text_only, true);
const vars = {
  empresa: 'Empresa sintética QA Digital', lead_id: '00000000-0000-4000-8000-000000000032',
  grupo: 'B3', regiao: 'teste-edp-sp-01', data_atual: '2026-12-07', data_yyyymmdd: 20261207,
  fase_digital: 'estudo', rca_certificado: true, reuniao_liberada: true, agenda_disponivel: false,
};
const cases = [
  { id: 'presencial-corrigido', variables: {},
    opening: 'Sou responsável pela conta de luz, somos de baixa tensão. Podemos conversar.',
    expected: { modalidade: 'presencial', endereco_confirmado: true, reuniao_solicitada: true, reuniao_agendada: false, grupo_divergente: false, transbordo_necessario: true },
  },
  { id: 'online-optante', variables: { grupo: 'optante' },
    opening: 'Sou responsável pela conta. Somos atendidos em média tensão e faturados como baixa tensão. Podemos conversar.',
    expected: { modalidade: 'online', endereco_confirmado: false, endereco_reuniao: '', reuniao_solicitada: true, reuniao_agendada: false, grupo_divergente: false, transbordo_necessario: true },
  },
  { id: 'regiao-bloqueada', variables: { rca_certificado: false, reuniao_liberada: false },
    opening: 'Sou responsável pela conta de luz de baixa tensão. Quero uma reunião presencial para amanhã. Vocês conseguem?',
    expected: { modalidade: 'nao_confirmada', endereco_confirmado: false, endereco_reuniao: '', reuniao_solicitada: false, reuniao_agendada: false, grupo_divergente: false, transbordo_necessario: false },
  },
];
const selected = args.includes('--case') ? cases.filter(c => c.id === option('--case')) : cases;
assert(selected.length, 'Caso desconhecido');
const receipt = { date: new Date().toISOString(), agent_id: agent, branch_id: branch, version_id: version,
  mode: 'text_only_websocket', telephone_calls: 0, audio_validated: false, database_persistence_validated: false,
  schema_sha256: createHash('sha256').update(readFileSync(join(root, 'data-collection.json'), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), cases: [] };
for (const c of selected) {
  assert(!existsSync(join(out, `${c.id}-session.json`)), 'Use outro diretório: não sobrescrever sessão anterior');
  const signed = await get(`conversation/get-signed-url?agent_id=${agent}&branch_id=${branch}&version_id=${version}`);
  const events = [];
  let conversationId, sessionFailure, turns = 0, addressGiven = false, corrected = false, finalConfirmation = false;
  console.log(`Iniciando ${c.id} (somente texto)`);
  await new Promise((resolveSession, reject) => {
    const ws = new WebSocket(signed.signed_url, ['convai']);
    const timer = setTimeout(() => { ws.close(); reject(new Error('Sessão excedeu 100 segundos')); }, 100_000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'conversation_initiation_client_data', branch_id: branch,
      conversation_config_override: { conversation: { text_only: true } },
      tool_mock_config: { mocking_strategy: 'all', fallback_strategy: 'raise_error' },
      dynamic_variables: { ...vars, ...c.variables } })));
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Falha WebSocket')); });
    ws.addEventListener('close', () => { clearTimeout(timer); resolveSession(); });
    ws.addEventListener('message', ({ data }) => {
      const e = JSON.parse(String(data));
      if (e.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', event_id: e.ping_event.event_id })); return; }
      if (e.type === 'audio') {
        events.push({ type: 'audio_discarded', bytes: e.audio_event?.audio_base_64?.length ?? 0 });
        return; // O servidor pode emitir um frame vazio de controle, mesmo em text_only.
      }
      events.push(e);
      if (e.type === 'conversation_initiation_metadata') conversationId = e.conversation_initiation_metadata_event.conversation_id;
      save(`${c.id}-session.json`, { conversation_id: conversationId, events });
      if (e.type !== 'agent_response') return;
      const message = e.agent_response_event.agent_response;
      console.log(`${c.id} / Karla: ${message}`);
      if (++turns > 10) { ws.close(); return; }
      const lower = message.toLowerCase();
      // Let end_call close naturally after the final statement.
      if (turns > 1 && !message.includes('?') && /obrigad|agradeço|vou encerrar|bom dia|ótimo dia|boa tarde|até logo|ainda não há reunião marcada/.test(lower)) return;
      let answer = c.opening;
      if (turns > 1) {
        if (c.id === 'presencial-corrigido') {
          if (/endereço|logradouro|rua|número|bairro|munic/.test(lower)) {
            if (!addressGiven) { answer = 'Rua das Flores, número 10, bairro Centro, Guarulhos, São Paulo, sem complemento.'; addressGiven = true; }
            else if (!corrected) { answer = 'Corrigindo: o número é 20, não 10. Rua das Flores, 20, Centro, Guarulhos, São Paulo, sem complemento.'; corrected = true; }
            else {
              finalConfirmation = message.includes('?') && /\b20\b/.test(message);
              answer = 'Confirmo: Rua das Flores, número 20, Centro, Guarulhos, São Paulo, sem complemento. Esse é o local da reunião presencial.';
            }
          } else if (/presencial|online|modalidade/.test(lower)) answer = 'Prefiro presencial.';
          else answer = 'Sim, aceito a reunião para fatura e estudo, e vou separar a fatura.';
        } else if (c.id === 'online-optante') answer = /reunião|online|modalidade/.test(lower)
          ? 'Sim, quero a reunião online para fatura e estudo. Entendo que ainda não está agendada.'
          : 'Sim, vou separar a fatura.';
        else answer = blockedRegionReply(events.filter(e => e.type === 'agent_response')
          .map(e => e.agent_response_event.agent_response));
      }
      events.push({ type: 'qa_user_message', text: answer });
      ws.send(JSON.stringify({ type: 'user_message', text: answer }));
    });
  }).catch(error => { sessionFailure = error.message; });
  assert(conversationId, 'Provedor não informou conversation_id');
  save(`${c.id}-session.json`, { conversation_id: conversationId, events });
  let result;
  for (let attempt = 0; attempt < 12; attempt++) {
    result = await get(`conversations/${conversationId}`);
    save(`${c.id}-conversation-private.json`, result);
    if (result.status === 'done' && result.analysis) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  const data = Object.fromEntries(Object.entries(result.analysis?.data_collection_results ?? {}).map(([k, v]) => [k, v.value]));
  const failures = [];
  if (sessionFailure) failures.push(sessionFailure);
  failures.push(...completionFailures(result.transcript ?? []));
  if (result.status !== 'done' || !result.analysis) failures.push('Conversa sem análise concluída');
  if (c.id === 'regiao-bloqueada') failures.push(...blockedRegionFailures(result.transcript ?? []));
  for (const [k, expected] of Object.entries(c.expected)) {
    // O provedor representa ausência de texto também como null; nunca é endereço confirmado.
    if (data[k] !== expected && !(k === 'endereco_reuniao' && expected === '' && data[k] === null)) failures.push(`${k}: esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(data[k])}`);
  }
  for (const field of Object.keys(schema)) if (!(field in data)) failures.push(`Campo ausente: ${field}`);
  if (c.id === 'presencial-corrigido') {
    let correctionSeen = false, confirmationSeen = false;
    for (const turn of result.transcript ?? []) {
      if (turn.role === 'user' && turn.message?.startsWith('Corrigindo:')) correctionSeen = true;
      if (correctionSeen && turn.role === 'user' && turn.message?.startsWith('Confirmo:')) confirmationSeen = true;
      if (correctionSeen && !confirmationSeen && turn.tool_calls?.some(t => t.tool_name === 'end_call')) failures.push('end_call antes da confirmação do endereço corrigido');
    }
  }
  if (c.id === 'presencial-corrigido' && (!corrected || !finalConfirmation || !/\b20\b/.test(data.endereco_reuniao ?? '') || /\b10\b/.test(data.endereco_reuniao ?? ''))) failures.push('Último endereço corrigido não comprovado por nova pergunta e resposta');
  const metadata = result.conversation_initiation_client_data;
  for (const [k, v] of Object.entries({ ...vars, ...c.variables })) if (metadata?.dynamic_variables?.[k] !== v) failures.push(`Metadado divergente: ${k}`);
  if (result.agent_id !== agent || result.version_id !== version || result.branch_id !== branch) failures.push('Identidade/versão da conversa divergente');
  if (metadata?.conversation_config_override?.conversation?.text_only !== true || metadata?.dynamic_variables?.system__is_text_only !== true) failures.push('Conversa não comprovada como somente texto');
  const row = { id: c.id, conversation_id: conversationId, status: result.status, fields: data, failures,
    conversation_sha256: hash(result), expected: c.expected };
  receipt.cases.push(row);
  save('receipt.json', receipt);
  console.log(JSON.stringify(row));
}
const afterMain = await get(`agents/${agent}`);
const afterCandidate = await get(`agents/${agent}?branch_id=${branch}`);
const behavior = a => ({ conversation_config: a.conversation_config, platform_settings: a.platform_settings, workflow: a.workflow });
assert.equal(hash(behavior(afterMain)), hash(behavior(main)), 'Agente principal mudou durante o teste');
assert.equal(hash(behavior(afterCandidate)), hash(behavior(candidate)), 'Candidata mudou durante o teste');
receipt.main_unchanged = true;
receipt.candidate_unchanged = true;
receipt.passed = receipt.cases.every(c => c.failures.length === 0);
save('receipt.json', receipt);
if (!receipt.passed) process.exitCode = 1;
