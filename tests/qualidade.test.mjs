import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairQualidade, versaoQualidade, mediana, hashVersaoHistorica } from '../backend/edge-functions/_shared/ldr-qualidade.mjs';
import { createHash } from 'node:crypto';
const turn = (role, elapsed, interrupted = false) => ({role, message:'synthetic', interrupted,
  conversation_turn_metrics: {metrics: {convai_ttf_audio_since_silence:{elapsed_time:elapsed}}}});

test('latency uses provider audio metric, not transcript timestamp or TTS-only latency', () => {
  const data={agent_id:'agent_x',version_id:'version_a',transcript:[turn('agent',0.12),turn('user',null),turn('agent',1.456,true)]};
  const q=extrairQualidade(data);
  assert.equal(q.primeiro_audio_ms,120); assert.equal(q.primeira_resposta_ms,1456);
  assert.equal(q.interrupcoes,1); assert.equal(q.turnos_com_interrupted,2);
  assert.equal(versaoQualidade(q),'elevenlabs:agent_x:version_a');
  assert.equal(versaoQualidade(extrairQualidade(data,{promptHash:'a'.repeat(64)})),'sha256:'+'a'.repeat(64));
});

test('missing, malformed or partial observations are unknown, not zero or failure', () => {
  for(const value of [null,{},'0',-1,Infinity,NaN]) {
    assert.equal(extrairQualidade({transcript:[turn('agent',value)]}).primeiro_audio_ms,null);
  }
  assert.equal(extrairQualidade({transcript:[{role:'agent',message:'hello',time_in_call_secs:0}]}).primeiro_audio_ms,null);
  assert.equal(extrairQualidade({transcript:[turn('agent',0.1),{role:'agent',message:'missing'}]}).interrupcoes,null);
  assert.equal(extrairQualidade(null).interrupcoes,null);
  assert.equal(extrairQualidade({transcript:[turn('agent',0)]}).primeiro_audio_ms,0);
  assert.equal(extrairQualidade({transcript:[turn('agent',0.1)]}).primeira_resposta_ms,null);
  assert.equal(versaoQualidade({prompt_hash:'bogus'}),'sem_versao');
});

test('only successful voicemail tool result establishes a provider detection', () => {
  const tool={type:'system',is_error:false,is_blocked:false,tool_has_been_called:true,
    result:{result_type:'voicemail_detection_success',status:'success'}};
  const extract=(result)=>extrairQualidade({transcript:[{role:'agent',tool_results:[result]}]}).secretaria_detectada;
  assert.equal(extract(tool),true);
  for(const patch of [{is_error:true},{is_error:undefined},{is_blocked:true},{tool_has_been_called:false},
                     {type:'webhook'},{result:{result_type:'voicemail_detection_success',status:'error'}}]) {
    assert.equal(extract({...tool,...patch}),false);
  }
  assert.equal(extrairQualidade({analysis:{result:'sem_atendimento'},transcript:[{role:'user',message:'caixa postal'}]}).secretaria_detectada,false);
});

test('telemetry contains no transcript text, contacts or tool arguments', () => {
  const q=extrairQualidade({transcript:[{...turn('agent',0.1),message:'PRIVATE',tool_calls:[{params_as_json:'SECRET'}]}],
    metadata:{phone_call:{external_number:'PRIVATE'}}});
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE|SECRET/);
  assert.equal(q.interrupcoes,0); assert.equal(q.interrupcoes_mal_resolvidas,undefined);
});

test('median excludes unknowns and preserves legitimate zeros', () => {
  assert.equal(mediana([null,NaN]),null); assert.equal(mediana([0,20,10,null]),10);
  assert.equal(mediana([20,10]),15);
});

test('historical hash requires exact version identity and matches SON-2.10 bytes',async()=>{
  const v={requested_agent_id:'agent_x',agent_id:'agent_x',requested_version_id:'v1',version_id:'v1',
    prompt:{prompt:'  Instrução\n'},agent:{first_message:'Olá! '},tts:{voice_id:'voice_x'}};
  const expected=createHash('sha256').update(JSON.stringify({schema_version:1,prompt:'  Instrução\n',first_message:'Olá! ',voice_id:'voice_x'})).digest('hex');
  assert.equal(await hashVersaoHistorica(v),expected);
  await assert.rejects(hashVersaoHistorica({...v,version_id:'current'}),/identity/);
  await assert.rejects(hashVersaoHistorica({...v,agent_id:'other'}),/identity/);
  const q=extrairQualidade({}, {promptHash:expected,promptHashSource:'versao_historica_verificada'});
  assert.equal(q.prompt_hash_fonte,'versao_historica_verificada');
});
