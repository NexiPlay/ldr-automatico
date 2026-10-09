import test from 'node:test';
import assert from 'node:assert/strict';
import {cadastralContext,handleCadastralContext} from '../backend/edge-functions/_shared/ldr-context.mjs';
import {contextTool,startContextWorkflow} from '../scripts/son29-start-context.mjs';
const token='synthetic-secret-for-context-tests-only';
const input=()=>({REFERENCIA_EMPRESA:'Oficina Horizonte',BRIEFING_REFERENCIA:JSON.stringify({disponivel:true,empresa:{nome_fantasia:'Oficina Horizonte',municipio:'Recife',socios:'PRIVADO',telefone:'PRIVADO'}})});
test('contexto preserva referência pública e não devolve pessoa, contato ou campos extras',()=>{
 const output=cadastralContext({...input(),resultado:'CONFIRMADO'});assert.equal(output.REFERENCIA_EMPRESA,'Oficina Horizonte');assert.equal(output.BRIEFING_REFERENCIA.empresa.municipio,'Recife');assert.ok(!JSON.stringify(output).includes('PRIVADO'));assert.ok(!('resultado' in output));
});
test('referência ausente não é substituída pelo briefing; briefing ausente válido não apaga referência',()=>{
 for(const REFERENCIA_EMPRESA of ['',null,'{{empresa}}',' '])assert.throws(()=>cadastralContext({...input(),REFERENCIA_EMPRESA}),/referencia/);
 const output=cadastralContext({...input(),BRIEFING_REFERENCIA:'{"disponivel":false}'});assert.equal(output.REFERENCIA_EMPRESA,'Oficina Horizonte');assert.equal(output.BRIEFING_REFERENCIA.disponivel,false);
 for(const BRIEFING_REFERENCIA of ['{','null','[]',null])assert.throws(()=>cadastralContext({...input(),BRIEFING_REFERENCIA}),/briefing/);
});
test('endpoint exige segredo próprio e valida método antes do conteúdo',async()=>{
 for(const secret of ['',undefined,'short'])assert.equal((await handleCadastralContext(new Request('https://edge.invalid'),secret)).status,401);
 const headers={'x-ldr-context-token':token};assert.equal((await handleCadastralContext(new Request('https://edge.invalid',{headers}),token)).status,405);
 const r=await handleCadastralContext(new Request('https://edge.invalid',{method:'POST',headers,body:JSON.stringify(input())}),token);assert.equal(r.status,200);assert.equal((await r.json()).REFERENCIA_EMPRESA,'Oficina Horizonte');
});
test('endpoint limita tamanho sem confiar no header e não reflete erro ou segredo',async()=>{
 const headers={'x-ldr-context-token':token};
 for(const [body,status] of [['x'.repeat(16001),413],['{',400],[JSON.stringify({...input(),REFERENCIA_EMPRESA:''}),400]]){
  const r=await handleCadastralContext(new Request('https://edge.invalid',{method:'POST',headers,body}),token);assert.equal(r.status,status);assert.ok(!(await r.text()).includes(token));
 }
});
test('ferramenta usa variáveis determinísticas, sem LLM decidir a referência e sem falar antes',()=>{
 const t=contextTool('synthetic-secret-id').tool_config;assert.equal(t.pre_tool_speech,'off');assert.equal(t.api_schema.request_body_schema.properties.REFERENCIA_EMPRESA.dynamic_variable,'empresa');assert.equal(t.api_schema.request_body_schema.properties.BRIEFING_REFERENCIA.dynamic_variable,'briefing_lead');assert.deepEqual(t.api_schema.request_headers,{'X-LDR-Context-Token':{secret_id:'synthetic-secret-id'}});assert.throws(()=>contextTool(''));
});
test('contexto roda antes do Bruno; erro mantém atendimento e regras originais',()=>{
 const base={workflow:{nodes:{start_node:{type:'start'}},edges:{}}};const before=structuredClone(base);const patch=startContextWorkflow(base,'tool-test');assert.deepEqual(base,before);assert.deepEqual(Object.keys(patch),['workflow']);assert.equal(patch.workflow.nodes.bruno_node.entry_behavior,'wait_for_user');assert.equal(patch.workflow.edges.context_continue.target,'bruno_node');assert.equal(patch.workflow.edges.context_continue.forward_condition.type,'unconditional');assert.deepEqual(patch.workflow.nodes.bruno_node.conversation_config,{});assert.equal(patch.workflow.nodes.context_node.tools[0].tool_id,'tool-test');
 assert.throws(()=>startContextWorkflow({workflow:{nodes:{s:{type:'start'},custom:{type:'tool'}},edges:{}}},'tool-test'),/mudou/);
});
