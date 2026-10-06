import { assertR5, normalize } from '../backend/edge-functions/_shared/ldr-policy.mjs';

// Deterministic checks complement the provider's evaluator, which has accepted
// premature hangups and goodbyes followed by another customer turn in practice.
export function assertTranscriptPolicy(turns, item, openingPolicy = "greeting_then_disclosure") {
  const fail = message => { throw new Error(`Transcrição ${item.id}: ${message}`); };
  const agent = turns.filter(t => t.role === 'agent');
  const speech = t => {
    const parts = [t.message || ''];
    for (const call of t.tool_calls || []) if (call.tool_name === 'end_call') {
      const args=JSON.parse(call.params_as_json); const message=args.system__message_to_speak || args.message || '';
      if (message && !parts.some(p=>normalize(p).includes(normalize(message)))) parts.push(message);
    }
    return parts.filter(Boolean);
  };
  const spoken = agent.flatMap(speech).filter(t => t.trim() && normalize(t) !== 'alo?');
  const firstUser = normalize(turns.find(t => t.role === 'user')?.message || '');
  const refused = /nao (?:vou|posso|quero|aceito)|sem tempo|nao.*informac|nao.*lig|retir|tirar.*lista|tire.*lista|so falo com (?:gente|humano)|\bpare\b|\bpara\b/.test(firstUser);
  const endCalls = agent.flatMap(t => t.tool_calls || []).filter(t => t.tool_name === 'end_call');
  if (!endCalls.length) fail('sem end_call');
  for (const call of endCalls) {
    const args = JSON.parse(call.params_as_json);
    if ((args.system__message_to_speak || args.message || '').includes('?')) fail('pergunta dentro de end_call');
  }
  if (openingPolicy === 'greeting_then_company_check') {
    const automatic = /destino.*(?:acessivel|disponivel)|3cx cannot reach|rotas disponiveis|numero.*registrado|voce ligou|bem.vindo|digite.*ramal|aguarde.*atendid|caixa postal/.test(firstUser);
    if (!refused && !automatic) {
      const firstReply = normalize(spoken[0] || '');
      if (!firstReply.includes('assistente virtual') || !firstReply.includes('tendencia energia')) fail('identificação virtual ausente');
    }
    if (automatic && spoken.some(t => /\?/.test(t) || t.trim().split(/\s+/).length > 2)) fail('fala ou pergunta para mensagem automática');
    let userAskedRecording = false;
    for (const turn of turns) {
      if (turn.role === 'user') { userAskedRecording = /grav|registrand/.test(normalize(turn.message || '')); continue; }
      if (turn.role !== 'agent') continue;
      const message = normalize(speech(turn).join(' '));
      if (/ligacao.*gravada|estamos gravando|esta sendo gravad/.test(message) && !userAskedRecording) fail('anúncio de gravação não solicitado');
      if (/posso ajudar|algo mais|posso perguntar/.test(message)) fail('oferta de ajuda adicional');
      if (message.split(/\s+/).filter(Boolean).length > 40) fail('fala longa');
    }
  } else if (!refused) assertR5(spoken[0] || '', 'primeira resposta substantiva');
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
  if (openingPolicy === 'greeting_then_company_check') {
    if (item.responsavel_permitido === false && requests.length) fail('responsável sem abertura');
    if (item.empresa_primeiro) {
      let askedCompany = false, replied = false;
      for (const turn of turns) {
        if (turn.role === 'user' && askedCompany) replied = true;
        if (turn.role !== 'agent') continue;
        const message = normalize(turn.message || '');
        if (/\?/.test(message) && /quem.*(?:energia|responsavel)|nome.*(?:energia|responsavel)|horario/.test(message) && !replied) fail('responsável antes de confirmar empresa');
        if (/\?/.test(message) && /falo com|(?:aqui|telefone).*empresa|e da /.test(message)) askedCompany = true;
      }
    }
  }
}
