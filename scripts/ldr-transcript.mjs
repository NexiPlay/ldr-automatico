import { assertR5, normalize } from '../backend/edge-functions/_shared/ldr-policy.mjs';

// Deterministic checks complement the provider's evaluator, which has accepted
// premature hangups and goodbyes followed by another customer turn in practice.
export function assertTranscriptPolicy(turns, item) {
  const fail = message => { throw new Error(`Transcrição ${item.id}: ${message}`); };
  const agent = turns.filter(t => t.role === 'agent');
  const spoken = agent.map(t => t.message || '').filter(t => t.trim() && normalize(t) !== 'alo?');
  const firstUser = normalize(turns.find(t => t.role === 'user')?.message || '');
  const refused = /nao (?:vou|posso|quero|aceito)|sem tempo|nao.*informac|nao.*lig|retir|tirar.*lista|tire.*lista|so falo com (?:gente|humano)|\bpare\b|\bpara\b/.test(firstUser);
  const endCalls = agent.flatMap(t => t.tool_calls || []).filter(t => t.tool_name === 'end_call');
  if (!endCalls.length) fail('sem end_call');
  for (const call of endCalls) {
    const args = JSON.parse(call.params_as_json);
    if ((args.system__message_to_speak || args.message || '').includes('?')) fail('pergunta dentro de end_call');
  }
  if (!refused) assertR5(spoken[0] || '', 'primeira resposta substantiva');
  if (!item.dynamic_variables.empresa && spoken.some(t => t.includes('?'))) fail('pergunta sem referência de empresa');
  let waitingForEnd = false;
  for (const turn of turns) {
    if (turn.role === 'user' && waitingForEnd) fail('esperou o cliente após despedida');
    if (turn.tool_calls?.some(t => t.tool_name === 'end_call')) waitingForEnd = false;
    else if (turn.role === 'agent' && !turn.interrupted && /ate logo|vou encerrar|encerro a|obrigad[oa] pela atencao/.test(normalize(turn.message || '')))
      waitingForEnd = true;
  }
  const requests = spoken.flatMap(t => normalize(t).match(/[^.!?]*\?/g) || [])
    .filter(q => /quem.*(?:energia|responsavel)|nome.*(?:energia|responsavel)|horario/.test(q));
  if (requests.length > 1) fail('pedido de responsável repetido');
}
