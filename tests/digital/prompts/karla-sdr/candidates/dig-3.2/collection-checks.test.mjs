import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { blockedRegionFailures, blockedRegionReply, completionFailures, refusal } from './collection-checks.mjs';

test('controle negativo: reprova a coleta histórica aprovada sem recusa da Karla', () => {
  const receipt = JSON.parse(readFileSync(new URL('../../../../documentacao/projetos/digital/qa-dig-3.2-2026-10-16.json', import.meta.url), 'utf8'));
  const transcript = receipt.provider_collection.cases.find(c => c.id === 'regiao-bloqueada').synthetic_transcript;
  assert.equal(blockedRegionFailures(transcript).length, 1);
});

test('fala do cliente e reason interno não substituem uma recusa audível', () => {
  assert.equal(blockedRegionFailures([
    { role: 'user', message: refusal },
    { role: 'agent', tool_calls: [{ tool_name: 'end_call', params_as_json: JSON.stringify({ reason: refusal, system__message_to_speak: 'Obrigada.' }) }] },
  ]).length, 1);
});

test('aceita recusa da agente em turno normal ou mensagem de end_call', () => {
  assert.deepEqual(blockedRegionFailures([{ role: 'agent', message: refusal }]), []);
  assert.deepEqual(blockedRegionFailures([{ role: 'agent', tool_calls: [{ tool_name: 'end_call', params_as_json: JSON.stringify({ system__message_to_speak: refusal }) }] }]), []);
});

test('cliente sintético insiste sem inventar uma recusa que não ouviu', () => {
  assert.match(blockedRegionReply(['Você pode separar a fatura?']), /vocês conseguem/);
  assert.equal(blockedRegionReply([refusal]), 'Entendi. Vou separar a fatura.');
});

test('agradecimento após confirmação não comprova encerramento, nem tool não executada', () => {
  const transcript = [
    { role: 'user', message: 'Confirmo: Rua das Flores, 20, Centro, Guarulhos/SP.' },
    { role: 'agent', message: 'Obrigada pela confirmação!' },
  ];
  assert.equal(completionFailures(transcript).length, 1);
  transcript.push({ role: 'agent', tool_calls: [{ tool_name: 'end_call', tool_has_been_called: false }] });
  assert.equal(completionFailures(transcript).length, 1);
  transcript.at(-1).tool_calls[0].tool_has_been_called = true;
  assert.deepEqual(completionFailures(transcript), []);
  delete transcript.at(-1).tool_calls[0].tool_has_been_called;
  assert.equal(completionFailures(transcript).length, 1);
});
