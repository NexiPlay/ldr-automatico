// Offline. Sorteia antes de consultar áudio/transcrição; artefatos privados em artifacts/.
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeGateAReviews, gateADecision } from '../backend/edge-functions/_shared/ldr-gate-a.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const unwrap = (data, key) => data.rows?.[0]?.[key] ?? data[key] ?? data;
const idPattern = /^conv_[a-zA-Z0-9_]+$/;

export function sampleCalls(candidates, seed) {
  if (!Array.isArray(candidates) || candidates.length < 50) throw new Error('Menos de 50 chamadas na população.');
  if (!/^[a-f0-9]{64}$/.test(seed)) throw new Error('Semente inválida.');
  if (candidates.some(c => !idPattern.test(c.conversation_id)) ||
      new Set(candidates.map(c => c.conversation_id)).size !== candidates.length)
    throw new Error('Identificadores inválidos ou repetidos.');
  return candidates.map(c => ({ call: c, rank: sha(seed + '\n' + c.conversation_id) }))
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.call.conversation_id.localeCompare(b.call.conversation_id))
    .slice(0, 50).map(({ call }, i) => ({ ...call, ordem: i + 1 }));
}

export function detailsSql(manifest) {
  if (manifest.calls.some(c => !idPattern.test(c.conversation_id))) throw new Error('Identificador inválido.');
  const ids = manifest.calls.map(c => `'${c.conversation_id}'`).join(',\n');
  return `begin read only;
select jsonb_agg(jsonb_build_object(
 'conversation_id',c.conversation_id,'resultado',c.resultado,'iniciada_em',c.iniciada_em,
 'duracao_seg',c.duracao_seg,'transcript',c.transcript,
 'empresa',coalesce(c.metadados->'conversation_initiation_client_data'->'dynamic_variables'->>'empresa',l.razao_social,l.nome_exibicao),
 'cnpj',l.cnpj,'telefone',t.e164,
 'contexto_da_chamada',c.metadados->'conversation_initiation_client_data'->'dynamic_variables'->>'empresa',
 'audio_path',c.audio_path,'audio_apagado_em',c.audio_apagado_em,
 'retencao_provedor',c.metadados->'metadata'->'deletion_settings'
)) as details
from public.np_ldr_conversas c left join public.np_leads l on l.id=c.lead_id
left join public.np_lead_telefones t on t.id=c.telefone_id
where c.conversation_id in (${ids});
rollback;\n`;
}

export function combineDetails(manifest, details) {
  if (!Array.isArray(details) || details.length !== 50 || new Set(details.map(c => c.conversation_id)).size !== 50)
    throw new Error('Detalhes incompletos ou duplicados; não substituir chamadas.');
  const byId = new Map(details.map(c => [c.conversation_id, c]));
  return manifest.calls.map(call => {
    const detail = byId.get(call.conversation_id);
    if (!detail || detail.resultado !== call.resultado || detail.iniciada_em !== call.iniciada_em)
      throw new Error('A identidade ou o veredito arquivado mudou desde o sorteio.');
    return { ...call, ...detail };
  });
}

async function main(args) {
  const [command, input, output] = args;
  if (command === 'select' && input && output) {
    const data = unwrap(await json(input), 'candidates');
    const rows = data.candidatas;
    if (new Set(rows.map(c => c.prompt_hash)).size !== 1 || !rows[0]?.prompt_hash ||
        new Set(rows.map(c => c.agent_id)).size !== 1 || rows.some(c => c.lote_id !== data.lote.id))
      throw new Error('A população precisa de um único lote, agente e hash do prompt.');
    const seed = randomBytes(32).toString('hex');
    const populationIds = rows.map(c => c.conversation_id).sort();
    const manifest = { schema: 1, task: 'SON-2.9', generated_at: new Date().toISOString(),
      frozen_at: data.capturado_em, lote: data.lote.codigo, lote_id: data.lote.id,
      agent_id: rows[0].agent_id, prompt_hash: rows[0].prompt_hash,
      population_size: rows.length, population_ids: populationIds,
      population_sha256: sha(JSON.stringify(populationIds)), seed,
      method: 'Amostra aleatória simples: 50 menores SHA-256(semente + quebra de linha + conversation_id). Sem filtro por resultado, duração, áudio ou transcrição.',
      scope: 'Chamadas reais do lote guarulhos_piloto_398 após a publicação do Bruno em 01/10/2026 13:15 BRT, até o instante de captura. Lote obtido do cadastro do lead na captura.',
      calls: sampleCalls(rows, seed) };
    manifest.sample_id = sha(JSON.stringify({ population: manifest.population_sha256, seed,
      ids: manifest.calls.map(c => c.conversation_id) })).slice(0, 24);
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await writeFile(output + '.sql', detailsSql(manifest), { flag: 'wx' });
    console.log(JSON.stringify({ sample_id: manifest.sample_id, universo: rows.length, sorteadas: 50 }));
  } else if (command === 'build' && input && output && args[3]) {
    const manifest = await json(input);
    const calls = combineDetails(manifest, unwrap(await json(output), 'details'));
    const target = resolve(args[3]);
    await mkdir(target, { recursive: true });
    for (const call of calls) {
      try { await access(resolve(target, 'audio', call.conversation_id + '.mp3')); call.audio_local = 'audio/' + call.conversation_id + '.mp3'; }
      catch { call.audio_local = null; }
    }
    const packet = { ...manifest, calls };
    if (args[4]) {
      const source = await json(args[4]);
      const state = mergeGateAReviews(packet, source);
      packet.checkpoint = { ...state, schema: 1, population_sha256: packet.population_sha256,
        prompt_hash: packet.prompt_hash, exported_at: new Date().toISOString(),
        gate: gateADecision(calls, state.reviews) };
      await writeFile(resolve(target, 'revisoes.json'), JSON.stringify(packet.checkpoint, null, 2) + '\n');
    }
    const template = await readFile(new URL('templates/son29-review.html', import.meta.url), 'utf8');
    const logic = (await readFile(new URL('../backend/edge-functions/_shared/ldr-gate-a.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
    const safeJson = JSON.stringify(packet).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    await writeFile(resolve(target, 'revisar.html'), template.replace('/*__GATE_LOGIC__*/', () => logic).replace('/*__PACKET__*/null', () => safeJson));
    await writeFile(resolve(target, 'amostra.json'), JSON.stringify(packet, null, 2) + '\n');
    const quote = value => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
    const columns = ['ordem','conversation_id','iniciada_em','empresa','cnpj','telefone','duracao_seg','resultado','resultado_humano','audio_ouvido','revisor','evidencia','revisado_em'];
    await writeFile(resolve(target, 'comparacao.csv'), '\uFEFF' + columns.join(';') + '\n' + calls.map(c => {
      const row = { ...c, ...packet.checkpoint?.reviews[c.conversation_id] };
      return columns.map(k => quote(row[k])).join(';');
    }).join('\n') + '\n');
    console.log(JSON.stringify({ pacote: target, chamadas: calls.length, audios_locais: calls.filter(c => c.audio_local).length,
      duracao_total_seg: calls.reduce((n,c) => n + (c.duracao_seg ?? 0), 0) }));
  } else throw new Error('Uso: select candidates.json manifest.json | build manifest.json details.json pasta-do-pacote [revisoes.json]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
