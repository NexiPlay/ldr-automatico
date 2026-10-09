import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareSon29,assertSon29Base,assertSon29Published} from '../scripts/son29-identity-prepare.mjs';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const approval=JSON.parse(await read('../prompts/bruno/candidates/son-2.9/baseline-approval.json'));
const fixture=()=>({agent_id:approval.agent_id,version_id:'synthetic-base',prompt:null,first_message:null,data_collection:{
 resultado_validacao:{type:'string',enum:['CONFIRMADO','NAO_CONFIRMADO','INCONCLUSIVO','SEM_ATENDIMENTO'],description:'Old rule',llm_billed:false},
 redflag:{type:'boolean',description:'Keep exact opt-out',name:'redflag'},
 son62_interlocutor:{type:'string',enum:['DECISOR','INTERMEDIARIO','NAO_IDENTIFICADO'],description:'Role'},
 son62_nome_responsavel:{type:'string',description:'Name'},son62_horario_retorno:{type:'string',description:'Time'},son62_pedidos:{type:'integer',description:'Count'},
 unrelated:{type:'string',description:'Preserve me',constant_value:'fixed'},
}});
async function base(){return {...fixture(),prompt:await read('../prompts/bruno/candidates/son-2.9/baseline-system.md'),first_message:await read('../prompts/bruno/first-message.txt')};}
function published(snapshot,prepared){return {...snapshot,version_id:'synthetic-new',prompt:prepared.patch.conversation_config.agent.prompt.prompt,data_collection:structuredClone(prepared.patch.platform_settings.data_collection)};}

test('candidate preparation preserves snapshot, opt-out, enum and unrelated fields',async()=>{
 const snapshot=await base(),before=structuredClone(snapshot),p=await prepareSon29(snapshot),fields=p.patch.platform_settings.data_collection;
 assert.deepEqual(snapshot,before);assert.deepEqual(fields.redflag,snapshot.data_collection.redflag);
 assert.deepEqual(fields.unrelated,snapshot.data_collection.unrelated);assert.deepEqual(fields.son62_pedidos,snapshot.data_collection.son62_pedidos);
 assert.deepEqual(fields.resultado_validacao.enum,snapshot.data_collection.resultado_validacao.enum);
 assert.equal('llm_billed' in fields.resultado_validacao,false);
 assert.deepEqual(Object.keys(p.patch.conversation_config),['agent']);assert.deepEqual(Object.keys(p.patch.conversation_config.agent),['prompt']);
 assert.deepEqual(Object.keys(p.patch.conversation_config.agent.prompt),['prompt']);
 assert.equal(p.candidate.status,'LOCAL_NAO_PUBLICADO');assert.equal(p.candidate.requires_model_validation,true);
 assert.equal(p.candidate.requires_new_human_audit,true);assert.notEqual(p.candidate.prompt_sha256,approval.prompt_sha256);
 assert.deepEqual(JSON.parse(await read('../prompts/bruno/candidates/son-2.9/baseline-approval.json')),approval);
});
test('candidate requires an approved baseline and the existing outcome contract',async()=>{
 for(const mutate of [s=>s.agent_id='other',s=>s.prompt+=' drift',s=>delete s.data_collection.redflag,s=>s.data_collection.resultado_validacao.enum=['CONFIRMADO'],s=>s.data_collection.son29_tipo_atendimento={type:'string'}]) {
  const s=await base();mutate(s);await assert.rejects(prepareSon29(s));
 }
});
test('pre-publication check detects analysis-only drift, not just prompt drift',async()=>{
 const s=await base(),p=await prepareSon29(s);assert.equal(await assertSon29Base(s,p),true);
 for(const mutate of [x=>x.version_id='changed',x=>x.prompt+=' drift',x=>x.data_collection.redflag.description='changed',x=>x.data_collection.unrelated.constant_value='other']) {
  const changed=structuredClone(s);mutate(changed);await assert.rejects(assertSon29Base(changed,p),/Base mudou/);
 }
});
test('readback requires both prompt and analysis to persist',async()=>{
 const s=await base(),p=await prepareSon29(s),live=published(s,p);
 assert.equal(await assertSon29Published(live,p),true);
 for(const mutate of [x=>x.prompt=s.prompt,x=>x.first_message='Hello',x=>delete x.data_collection.son29_evidencia_identidade,x=>x.data_collection.resultado_validacao.description='old',x=>x.data_collection.redflag.description='lost']) {
  const changed=structuredClone(live);mutate(changed);await assert.rejects(assertSon29Published(changed,p));
 }
});
test('full agent snapshots are supported without including model, voice or tools in patch',async()=>{
 const s=await base();const full={agent_id:s.agent_id,version_id:s.version_id,conversation_config:{tts:{voice_id:'keep'},agent:{first_message:s.first_message,prompt:{prompt:s.prompt,llm:'keep',tools:[{name:'end_call'}]}}},platform_settings:{data_collection:s.data_collection,testing:{keep:true}}};
 assert.deepEqual(await prepareSon29(full),await prepareSon29(s));
});
