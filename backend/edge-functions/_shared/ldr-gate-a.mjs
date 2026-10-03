// SON-2.9: contabiliza referências humanas; não produz avaliações automáticas.
export const GATE_A_RESULTS = ['confirmado', 'nao_confirmado', 'inconclusivo', 'sem_atendimento'];

// Checkpoints portáteis e armazenamento local pertencem à mesma amostra.
// Mescla por conversa para não apagar trabalho mais recente deste navegador.
export function mergeGateAReviews(packet, ...sources) {
  const state = { sample_id: packet.sample_id, revisor: '', reviews: {} };
  const ids = new Set(packet.calls.map(c => c.conversation_id));
  for (const source of sources.filter(Boolean)) {
    if (source.sample_id !== packet.sample_id || !source.reviews ||
        typeof source.reviews !== 'object' || Array.isArray(source.reviews) ||
        (source.revisor !== undefined && typeof source.revisor !== 'string') ||
        (source.population_sha256 && source.population_sha256 !== packet.population_sha256) ||
        (source.prompt_hash && source.prompt_hash !== packet.prompt_hash))
      throw new Error('O arquivo pertence a outra amostra ou está inválido.');
    if (source.revisor) state.revisor = source.revisor;
    for (const [id, review] of Object.entries(source.reviews)) {
      if (!ids.has(id) || !review || typeof review !== 'object' ||
          !['', ...GATE_A_RESULTS, 'nao_auditavel'].includes(review.resultado_humano) ||
          typeof review.audio_ouvido !== 'boolean' || typeof review.evidencia !== 'string' ||
          typeof review.revisor !== 'string' || typeof review.revisado_em !== 'string')
        throw new Error('Revisão inválida ou chamada fora da amostra.');
      const previous = state.reviews[id];
      const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
      if (!previous || time(review.revisado_em) >= time(previous.revisado_em))
        state.reviews[id] = { ...review };
    }
  }
  return state;
}

export function gateADecision(calls, reviews) {
  if (!Array.isArray(calls) || calls.length !== 50 || new Set(calls.map(c => c.conversation_id)).size !== 50)
    throw new Error('O Gate A exige exatamente 50 chamadas distintas.');
  let reviewed = 0, correct = 0, unavailable = 0;
  const confusion = {};
  for (const call of calls) {
    const review = reviews?.[call.conversation_id];
    if (review?.resultado_humano === 'nao_auditavel') unavailable++;
    if (!review || !GATE_A_RESULTS.includes(review.resultado_humano) ||
        review.audio_ouvido !== true || typeof review.revisor !== 'string' || !review.revisor.trim() ||
        typeof review.evidencia !== 'string' || !review.evidencia.trim() ||
        !Number.isFinite(Date.parse(review.revisado_em))) continue;
    reviewed++;
    if (call.resultado === review.resultado_humano) correct++;
    const pair = `${call.resultado ?? 'sem_veredito'} → ${review.resultado_humano}`;
    confusion[pair] = (confusion[pair] || 0) + 1;
  }
  return { total: 50, revisadas: reviewed, pendentes: 50 - reviewed, indisponiveis: unavailable,
    acertos: correct, erros: reviewed - correct,
    percentual: reviewed === 50 ? correct * 2 : null,
    decisao: reviewed < 50 ? 'pendente' : correct >= 45 ? 'aprovado' : 'reprovado',
    confusao: confusion };
}
