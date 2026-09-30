// SON-6.8. Pure extraction: observations, not inferred audio quality.
// No text, phone numbers, prompts or tool arguments are copied into telemetry.
export const QUALIDADE_SCHEMA = 1;
const object = (x) => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const text = (x) => typeof x === 'string' && x.trim() ? x.trim().slice(0, 160) : null;
const hash = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x) ? x.toLowerCase() : null;

function milliseconds(turn) {
  const value = object(object(object(turn).conversation_turn_metrics).metrics)
    .convai_ttf_audio_since_silence?.elapsed_time;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 86400
    ? Math.round(value * 1000) : null;
}

function voicemail(turns) {
  // Merely requesting the tool, mentioning voicemail, or sem_atendimento is
  // not proof that the tool succeeded. Error and blocked results do not count.
  return turns.some((turn) => (Array.isArray(turn.tool_results) ? turn.tool_results : []).some((raw) => {
    const result = object(raw);
    const value = object(result.result);
    return result.type === 'system' && result.is_error === false && result.is_blocked !== true &&
      result.tool_has_been_called === true && value.result_type === 'voicemail_detection_success' &&
      value.status === 'success';
  }));
}

export function extrairQualidade(raw, options = {}) {
  const data = object(raw);
  const turns = (Array.isArray(data.transcript) ? data.transcript : []).map(object);
  const spoken = (turn) => typeof turn.message === 'string' && turn.message.trim().length > 0;
  const agents = turns.filter((turn) => turn.role === 'agent' && spoken(turn));
  const firstUser = turns.findIndex((turn) => turn.role === 'user' && spoken(turn));
  const firstReply = firstUser < 0 ? undefined
    : turns.slice(firstUser + 1).find((turn) => turn.role === 'agent' && spoken(turn));
  const interruptionCoverage = agents.filter((turn) => typeof turn.interrupted === 'boolean').length;
  return {
    schema: QUALIDADE_SCHEMA,
    prompt_hash: hash(options.promptHash),
    prompt_hash_fonte: hash(options.promptHash)
      ? (options.promptHashSource === 'versao_historica_verificada' ? 'versao_historica_verificada' : 'carimbo_pre_disparo') : null,
    provider_version_id: text(data.version_id),
    agent_id: text(data.agent_id),
    // Provider time-to-first-audio since silence. It is not a measurement of
    // SIP pickup delay, listener playback, or audio-verified word onset.
    primeiro_audio_ms: agents.length ? milliseconds(agents[0]) : null,
    primeira_resposta_ms: firstReply ? milliseconds(firstReply) : null,
    latencia_fonte: 'elevenlabs:convai_ttf_audio_since_silence',
    turnos_agente: agents.length,
    turnos_com_interrupted: interruptionCoverage,
    interrupcoes: agents.length && interruptionCoverage === agents.length
      ? agents.filter((turn) => turn.interrupted === true).length : null,
    // Failure rate and transcription errors require an audio-based reference.
    // A successful interruption is not a failure, and missing review is not 0.
    secretaria_detectada: turns.length ? voicemail(turns) : null,
    deteccao_fonte: 'elevenlabs:voicemail_detection_success',
  };
}

export function versaoQualidade(telemetry) {
  const q = object(telemetry);
  if (hash(q.prompt_hash)) return 'sha256:' + hash(q.prompt_hash);
  if (text(q.agent_id) && text(q.provider_version_id)) {
    return 'elevenlabs:' + text(q.agent_id) + ':' + text(q.provider_version_id);
  }
  return 'sem_versao';
}

export function mediana(values) {
  const sorted = values.filter((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function hashVersaoHistorica(version) {
  if (!version || version.agent_id !== version.requested_agent_id ||
      version.version_id !== version.requested_version_id || !text(version.version_id) ||
      typeof version.prompt?.prompt !== 'string' || !version.prompt.prompt.trim() ||
      typeof version.tts?.voice_id !== 'string' || !version.tts.voice_id.trim() ||
      (version.agent?.first_message != null && typeof version.agent.first_message !== 'string')) {
    throw new Error('Historical version identity or configuration missing');
  }
  // Exactly the same ordered object and UTF-8 serialization as SON-2.10.
  const bytes = new TextEncoder().encode(JSON.stringify({schema_version:1,prompt:version.prompt.prompt,
    first_message:version.agent?.first_message ?? null,voice_id:version.tts.voice_id}));
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
