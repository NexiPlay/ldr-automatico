import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extrairPorteiro} from '../backend/edge-functions/_shared/ldr-porteiro.mjs';
import {prepareSon62} from '../scripts/son62-prepare.mjs';
import {assertApprovedAgent} from '../backend/edge-functions/_shared/ldr-policy.mjs';

const said = 'Sim, aqui é a empresa. Sou a recepcionista. O Carlos cuida de energia, mas está ausente. Ligue amanhã às 14h.';
const fields = {
  resultado_validacao:'CONFIRMADO',son62_interlocutor:'INTERMEDIARIO',son62_interlocutor_evidencia:'Sou a recepcionista.',
  son62_responsavel_ausente:true,son62_ausencia_evidencia:'O Carlos cuida de energia, mas está ausente.',
  son62_nome_responsavel:'Carlos',son62_nome_evidencia:'O Carlos cuida de energia, mas está ausente.',
  son62_horario_retorno:'amanhã às 14h',son62_horario_evidencia:'Ligue amanhã às 14h.',
  son62_recusa:false,son62_pedidos:1,
};
const payload=(change={},transcript=[{role:'user',message:said}])=>({transcript,
  analysis:{data_collection_results:Object.fromEntries(Object.entries({...fields,...change}).map(([k,value])=>[k,{value}]))}});

test('SON-6.2: confirmed company with absent decision maker keeps separate verdict and grounded contact',()=>{
  const r=extrairPorteiro(payload());
  assert.equal(r.resultado_validacao,'confirmado');assert.equal(r.diagnostico,'decisor_ausente');
  assert.equal(r.nome_responsavel,'Carlos');assert.equal(r.horario_retorno_texto,'amanhã às 14h');
  assert.equal(r.proximo_passo_reportado,true);assert.equal(r.revisao_humana_pendente,true);
  assert.equal(r.pedidos,1);assert.equal(r.recusa,false);
});
test('SON-6.2: wrong company cannot donate a name/time even with a real quotation',()=>{
  const r=extrairPorteiro(payload(),'nao_confirmado');
  assert.equal(r.diagnostico,'numero_errado');assert.equal(r.nome_responsavel,null);
  assert.equal(r.horario_retorno_texto,null);assert.equal(r.proximo_passo_reportado,null);
});
test('SON-6.2: source must be the user, never the agent, briefing or an invented quote',()=>{
  for(const turns of [[],[{role:'agent',message:said}],[{role:'system',message:said}],[{role:'user',message:'Alô?'}]]) {
    const r=extrairPorteiro(payload({},turns));
    assert.equal(r.nome_responsavel,null);assert.equal(r.interlocutor,null);assert.equal(r.responsavel_ausente,null);
  }
  const r=extrairPorteiro(payload({son62_nome_responsavel:'João',son62_horario_retorno:'2026-09-30T14:00:00-03:00'}));
  assert.equal(r.nome_responsavel,null);assert.equal(r.horario_retorno_texto,null);
});
test('SON-6.2: one useful item suffices; refused or absent contact is not a wrong number',()=>{
  const onlyTime=extrairPorteiro(payload({son62_nome_responsavel:''}));
  assert.equal(onlyTime.proximo_passo_reportado,true);assert.equal(onlyTime.nome_responsavel,null);
  const denied=extrairPorteiro(payload({son62_nome_responsavel:'',son62_horario_retorno:'',son62_recusa:true}));
  assert.equal(denied.proximo_passo_reportado,false);assert.equal(denied.diagnostico,'decisor_ausente');
  assert.equal(denied.resultado_validacao,'confirmado');
});
test('SON-6.2: malformed/legacy data does not turn unknowns into success',()=>{
  for(const raw of [null,[],{}, {analysis:{data_collection_results:{son62_future:'x'}}}]) assert.equal(extrairPorteiro(raw),null);
  for(const bad of ['1',-1,101,1.5,null]) assert.equal(extrairPorteiro(payload({son62_pedidos:bad})).pedidos,null);
  assert.equal(extrairPorteiro(payload({son62_responsavel_ausente:'true'})).responsavel_ausente,null);
  assert.equal(extrairPorteiro(payload({son62_interlocutor:'ADMIN'})).interlocutor,null);
  const raw=payload();for(const v of Object.values(raw.analysis.data_collection_results)) {v.valor=v.value;delete v.value;}
  assert.equal(extrairPorteiro(raw).nome_responsavel,'Carlos');
  const referenced=payload();referenced.analysis.data_collection_results=Object.fromEntries(
    Object.entries(referenced.analysis.data_collection_results).map(([name,value],i)=>['aitem_'+i,{...value,name}]));
  assert.equal(extrairPorteiro(referenced).nome_responsavel,'Carlos');
  referenced.analysis.data_collection_results.duplicate={name:'son62_nome_responsavel',value:'Outra pessoa'};
  assert.equal(extrairPorteiro(referenced).nome_responsavel,null);
});
test('SON-6.2: decisor, no answer and inconclusive are distinct from gatekeeper samples',()=>{
  const decisor=extrairPorteiro(payload({son62_interlocutor:'DECISOR',son62_interlocutor_evidencia:'Eu cuido de energia.'},
    [{role:'user',message:'Sim, empresa confirmada. Eu cuido de energia.'}]));
  assert.equal(decisor.diagnostico,'decisor_presente');assert.equal(decisor.proximo_passo_reportado,null);
  assert.equal(extrairPorteiro(payload(),'sem_atendimento').diagnostico,'sem_atendimento');
  assert.equal(extrairPorteiro(payload(),'inconclusivo').nome_responsavel,null);
});

test('SON-6.2: offline preparation preserves configuration and approval; remote drift is rejected',async()=>{
  const text=async path=>readFile(new URL(path,import.meta.url),'utf8');
  const approval=JSON.parse(await text('../backend/edge-functions/_shared/ldr-approval.json'));
  const base={agent_id:approval.agent_id,version_id:'test-version',conversation_config:{
    tts:{voice_id:'preserve-voice'},agent:{first_message:await text('../prompts/bruno/first-message.txt'),
      prompt:{prompt:await text('../prompts/bruno/system.md'),llm:'preserve-model',tools:[{type:'system',name:'end_call'}]}}},
    platform_settings:{data_collection:{resultado_validacao:{type:'string',enum:['CONFIRMADO','NAO_CONFIRMADO','INCONCLUSIVO','SEM_ATENDIMENTO'],description:'base',llm_billed:false},
      redflag:{type:'boolean',description:'opt-out'},existing:{type:'string',description:'keep'}}}};
  const initial=structuredClone(base), prepared=await prepareSon62(base);
  assert.deepEqual(base,initial);assert.deepEqual(prepared.patch.conversation_config.tts,base.conversation_config.tts);
  assert.equal(prepared.patch.conversation_config.agent.first_message,base.conversation_config.agent.first_message);
  assert.deepEqual(prepared.patch.conversation_config.agent.prompt.tools,base.conversation_config.agent.prompt.tools);
  const fields=prepared.patch.platform_settings.data_collection;
  assert.deepEqual(fields.redflag,base.platform_settings.data_collection.redflag);
  assert.deepEqual(fields.existing,base.platform_settings.data_collection.existing);
  assert.deepEqual(fields.resultado_validacao.enum,base.platform_settings.data_collection.resultado_validacao.enum);
  assert.ok(!('llm_billed' in fields.resultado_validacao));assert.equal(Object.keys(fields).filter(k=>k.startsWith('son62_')).length,10);
  await assertApprovedAgent(base,approval);
  await assertApprovedAgent({...base,conversation_config:prepared.patch.conversation_config},prepared.proposedApproval);
  await assert.rejects(prepareSon62({...base,agent_id:'other'}));
  base.conversation_config.agent.prompt.prompt+=' changed';await assert.rejects(prepareSon62(base),/diverge/);
  const oldRefs={evaluation_criteria:[],data_collection:[{source:'user',analysis_item_id:'aitem_old1',version_id:null,scope:'conversation'}]};
  const migrated={...initial,platform_settings:{...initial.platform_settings,analysis_items:oldRefs}};
  const plan=await prepareSon62(migrated);
  assert.equal(plan.patch,null);assert.equal(plan.dataCollectionProposal.requires_item_creation,true);
  assert.deepEqual(plan.dataCollectionProposal.existing_references,oldRefs);
  const refs=Object.fromEntries(Object.keys(plan.dataCollectionProposal.definitions).map((k,i)=>[k,{source:'user',analysis_item_id:'aitem_new'+i,version_id:'version-'+i}]));
  const ready=await prepareSon62(migrated,refs);
  assert.equal(ready.patch.platform_settings.data_collection,undefined);
  const linked=ready.patch.platform_settings.analysis_items;
  assert.deepEqual(linked.data_collection[0],oldRefs.data_collection[0]);assert.equal(linked.data_collection.length,11);
  assert.deepEqual(linked.evaluation_criteria,oldRefs.evaluation_criteria);
  const key=Object.keys(refs)[0];refs[key].analysis_item_id='aitem_old1';
  await assert.rejects(prepareSon62(migrated,refs),/reutilizada/);
  await assert.rejects(prepareSon62(migrated,{}),/dez referencias/);
});
