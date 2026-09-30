// Read-only offline baseline. Provider snapshots stay private. Output contains aggregates only.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extrairQualidade, versaoQualidade, mediana, hashVersaoHistorica } from '../backend/edge-functions/_shared/ldr-qualidade.mjs';

export function summarize(observations) {
  const groups = new Map();
  for (const {qualidade:q} of observations) {
    const version = versaoQualidade(q);
    if (!groups.has(version)) groups.set(version,[]);
    groups.get(version).push(q);
  }
  const metric=(rows,key)=>({n:rows.filter(x=>typeof x[key]==='number').length,
    mediana_ms:mediana(rows.map(x=>x[key]))});
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([versao,rows])=>({
    versao,chamadas:rows.length,
    primeiro_audio:metric(rows,'primeiro_audio_ms'),
    primeira_resposta:metric(rows,'primeira_resposta_ms'),
    chamadas_com_interrupcao:rows.filter(x=>x.interrupcoes>0).length,
    chamadas_com_telemetria_interrupcao:rows.filter(x=>x.interrupcoes!==null).length,
    interrupcoes_observadas:rows.reduce((n,x)=>n+(x.interrupcoes??0),0),
    bargein_mal_resolvido_pct:null,
    cnpj_erro_pct:null,nome_erro_pct:null,
    secretaria_deteccoes_provedor:rows.filter(x=>x.secretaria_detectada).length,
    secretaria_recall_pct:null,
  }));
}

async function main(args) {
  if(args.length!==5) throw new Error('Usage: node son68-baseline.mjs PRIVATE_PROVIDER_DIR STAMPS_JSON VERSIONS_JSON REPORT_JSON PRIVATE_TELEMETRY_JSON');
  const [input,stampsPath,versionsPath,output,telemetryPath]=args;
  const stamps=new Map(JSON.parse(await readFile(stampsPath,'utf8')).result.map(x=>[x.ia_conversation_id,x.ia_prompt_hash]));
  const versions = new Map();
  for (const v of JSON.parse(await readFile(versionsPath,'utf8'))) {
    versions.set(v.agent_id+':'+v.version_id,await hashVersaoHistorica(v));
  }
  const observations=[];
  const ids=JSON.parse(await readFile(resolve(input,'manifest.json'),'utf8')).conversation_ids;
  if(!Array.isArray(ids) || !ids.length || new Set(ids).size!==ids.length || ids.some(id=>!/^conv_[a-zA-Z0-9_]+$/.test(id))) {
    throw new Error('Invalid, empty or duplicate snapshot manifest');
  }
  for(const id of ids.slice().sort()) {
    const file=id+'.json';
    const snapshot=JSON.parse(await readFile(resolve(input,file),'utf8'));
    const data=snapshot.data;
    if(file!==data.conversation_id+'.json') throw new Error('Snapshot identity mismatch');
    const override=data.conversation_initiation_client_data?.conversation_config_override;
    if(override?.agent?.prompt?.prompt!=null || override?.agent?.first_message!=null || override?.tts?.voice_id!=null) {
      throw new Error('Per-call prompt/voice override requires separate hash attribution');
    }
    const stamped=stamps.get(data.conversation_id), recovered=versions.get(data.agent_id+':'+data.version_id);
    if(stamped && recovered && stamped!==recovered) throw new Error('Historical hash disagrees with pre-dispatch stamp; inspect privately');
    observations.push({conversation_id:data.conversation_id,
      qualidade:extrairQualidade(data,{promptHash:stamped||recovered,
        promptHashSource:stamped?'carimbo_pre_disparo':'versao_historica_verificada'})});
  }
  const report={generated_at_utc:new Date().toISOString(),
    scope:'Conversas LDR arquivadas em np_ldr_conversas; inclui historico e testes, nao representa um lote piloto aprovado.',
    chamadas:observations.length,
    com_hash_prompt:observations.filter(x=>x.qualidade.prompt_hash).length,
    com_carimbo_original:observations.filter(x=>x.qualidade.prompt_hash_fonte==='carimbo_pre_disparo').length,
    com_hash_reconstruido:observations.filter(x=>x.qualidade.prompt_hash_fonte==='versao_historica_verificada').length,
    com_versao_provedor:observations.filter(x=>x.qualidade.provider_version_id).length,
    primeiro_audio_ms:mediana(observations.map(x=>x.qualidade.primeiro_audio_ms)),
    primeira_resposta_ms:mediana(observations.map(x=>x.qualidade.primeira_resposta_ms)),
    latencia_fonte:'ElevenLabs convai_ttf_audio_since_silence.elapsed_time, em segundos, convertido para ms.',
    limitacoes:['Tempo reportado ate audio, nao atraso SIP nem primeira palavra confirmada pela gravacao.',
      'Interrupcao observada nao prova barge-in mal resolvido.',
      'Erro de CNPJ/nome e recall de secretaria exigem referencia humana independente.',
      'Hashes historicos reconstituidos a partir da versao exata; nao sao carimbos capturados antes do disparo.',
      'R2 depende da integracao com SON-1.7; nenhuma tentativa foi alterada.'],
    versoes:summarize(observations)};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  await writeFile(telemetryPath,JSON.stringify(observations,null,2)+'\n');
  console.log(JSON.stringify({chamadas:report.chamadas,com_hash_prompt:report.com_hash_prompt,
    com_versao_provedor:report.com_versao_provedor,versoes:report.versoes.length,
    primeiro_audio_ms:report.primeiro_audio_ms,primeira_resposta_ms:report.primeira_resposta_ms}));
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error)=>{console.error(error.message);process.exitCode=1;});
}
