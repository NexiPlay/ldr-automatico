// SON-6.2: supplementary contact outcome; never changes company validation,
// opt-out, permission to dial, scheduling, or the retry budget.
const object = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const field = (fields, key) => {
  const named = Object.values(fields).filter(value => object(value).name === key);
  // Referenced analysis items may be keyed by item ID; duplicate names are ambiguous.
  const raw = Object.hasOwn(fields,key) ? fields[key] : named.length === 1 ? named[0] : undefined;
  return raw && typeof raw === 'object' ? raw.value ?? raw.valor ?? null : raw;
};
const text = (x, max) => typeof x === 'string' && x.trim() && x.trim().length <= max
  ? x.trim().replace(/[\u0000-\u001f\u007f]/g, ' ') : null;
const normalized = x => String(x).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const enumValue = (x, values) => typeof x === 'string' && values.includes(x.trim().toLowerCase())
  ? x.trim().toLowerCase() : null;

/** @param {unknown} raw @param {string | null} [resultadoValidacao] */
export function extrairPorteiro(raw, resultadoValidacao = null) {
  const data = object(raw);
  const fields = object(object(data.analysis).data_collection_results);
  // Old calls are unknown, not a failed attempt at the new tactic.
  if (field(fields, 'son62_interlocutor') === undefined) return null;
  const turns = (Array.isArray(data.transcript) ? data.transcript : [])
    .map(object).filter(t => t.role === 'user' && typeof t.message === 'string');
  const evidence = (key) => {
    const quote = text(field(fields, key), 500);
    return quote && turns.some(t => normalized(t.message).includes(normalized(quote))) ? quote : null;
  };
  const contactEvidence = evidence('son62_interlocutor_evidencia');
  const role = contactEvidence ? enumValue(field(fields, 'son62_interlocutor'),
    ['decisor', 'intermediario', 'nao_identificado']) : null;
  const absentEvidence = evidence('son62_ausencia_evidencia');
  const absentRaw = field(fields, 'son62_responsavel_ausente');
  const absent = absentEvidence && typeof absentRaw === 'boolean' ? absentRaw : null;
  const refusal = field(fields, 'son62_recusa');
  const requests = field(fields, 'son62_pedidos');
  const result = enumValue(resultadoValidacao ?? field(fields, 'resultado_validacao'),
    ['confirmado', 'nao_confirmado', 'inconclusivo', 'sem_atendimento']);
  const extracted = (key, quoteKey, max) => {
    const value = text(field(fields, key), max), quote = evidence(quoteKey);
    return value && quote && normalized(quote).includes(normalized(value))
      ? {value, quote} : {value:null, quote:null};
  };
  // A wrong number cannot donate a contact to the reference company. Source
  // quotes must come from the interlocutor, never the prompt or agent's guess.
  const name = extracted('son62_nome_responsavel', 'son62_nome_evidencia', 120);
  const time = extracted('son62_horario_retorno', 'son62_horario_evidencia', 160);
  const canAssociate = result === 'confirmado' && ['intermediario', 'decisor'].includes(role);
  const nameValue = canAssociate ? name.value : null;
  const timeValue = canAssociate ? time.value : null;
  const diagnosis = result === 'nao_confirmado' ? 'numero_errado'
    : result === 'sem_atendimento' ? 'sem_atendimento'
    : result !== 'confirmado' ? 'identidade_inconclusiva'
    : role === 'intermediario' && absent === true ? 'decisor_ausente'
    : role === 'intermediario' ? 'intermediario'
    : role === 'decisor' ? 'decisor_presente' : 'interlocutor_desconhecido';
  return {
    schema:1, fonte:'elevenlabs:data_collection', resultado_validacao:result,
    diagnostico:diagnosis, interlocutor:role, responsavel_ausente:absent,
    nome_responsavel:nameValue, horario_retorno_texto:timeValue,
    interlocutor_evidencia:contactEvidence, ausencia_evidencia:absentEvidence,
    nome_evidencia:nameValue ? name.quote : null, horario_evidencia:timeValue ? time.quote : null,
    recusa:typeof refusal === 'boolean' ? refusal : null,
    pedidos:typeof requests === 'number' && Number.isInteger(requests) && requests >= 0 && requests <= 100 ? requests : null,
    // Presence of grounded extraction is not proof of a reviewed success.
    proximo_passo_reportado:role === 'intermediario' && result === 'confirmado'
      ? Boolean(nameValue || timeValue) : null,
    revisao_humana_pendente:true,
  };
}
