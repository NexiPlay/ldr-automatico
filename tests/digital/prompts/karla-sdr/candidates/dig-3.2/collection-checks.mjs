// Evidência de fala deve vir da agente, nunca da resposta do cliente ou do reason.
export const refusal = 'Ainda não posso oferecer uma reunião para a sua região.';
const normalize = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function agentSpeech(transcript) {
  return transcript.filter(turn => turn.role === 'agent').flatMap(turn => {
    const messages = [turn.message].filter(Boolean);
    for (const call of turn.tool_calls ?? turn.end_call ?? []) {
      if ((call.tool_name ?? call.name) !== 'end_call') continue;
      let parameters = call.params_as_json ?? call.parameters ?? {};
      if (typeof parameters === 'string') {
        try { parameters = JSON.parse(parameters); } catch { continue; }
      }
      if (parameters.system__message_to_speak) messages.push(parameters.system__message_to_speak);
    }
    return messages;
  });
}

export function hasExplicitRefusal(messages) {
  return messages.some(message => normalize(message).includes(normalize(refusal)));
}

export function blockedRegionFailures(transcript) {
  return hasExplicitRefusal(agentSpeech(transcript)) ? []
    : ['Região bloqueada: a Karla não disse a recusa explícita de reunião exigida pelo roteiro'];
}

// O cliente sintético confirma somente o que ouviu. Sua fala não pode aprovar o teste.
export function blockedRegionReply(messages) {
  return hasExplicitRefusal(messages)
    ? 'Entendi. Vou separar a fatura.'
    : 'Vou separar a fatura. Mas vocês conseguem a reunião presencial para amanhã?';
}

export function completionFailures(transcript) {
  const ended = transcript.some(turn => turn.role === 'agent' &&
    (turn.tool_calls ?? turn.end_call ?? []).some(call =>
      (call.tool_name ?? call.name) === 'end_call' && call.tool_has_been_called === true));
  return ended ? [] : ['A agente não encerrou via end_call; agradecimento ou timeout não concluem a coleta'];
}
