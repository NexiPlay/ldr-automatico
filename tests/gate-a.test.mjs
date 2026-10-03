import test from 'node:test';
import assert from 'node:assert/strict';
import { gateADecision, mergeGateAReviews } from '../backend/edge-functions/_shared/ldr-gate-a.mjs';
import { sampleCalls, combineDetails } from '../scripts/son29-prepare.mjs';

const calls = Array.from({length:50},(_,i)=>({conversation_id:`conv_${i}`,resultado:'confirmado',iniciada_em:'2026-10-02T15:00:00+00:00'}));
const reviews = (correct=50) => Object.fromEntries(calls.map((c,i)=>[c.conversation_id,{
  resultado_humano:i<correct?'confirmado':'inconclusivo',audio_ouvido:true,revisor:'Revisor de teste',
  evidencia:'00:18 — referência humana fictícia para teste',revisado_em:'2026-10-02T18:00:00Z'}]));

test('45/50 passa e 44/50 reprova, sem arredondar o limiar',()=>{
 assert.equal(gateADecision(calls,reviews(45)).decisao,'aprovado');
 assert.equal(gateADecision(calls,reviews(45)).percentual,90);
 assert.equal(gateADecision(calls,reviews(44)).decisao,'reprovado');
});
test('49 revisões perfeitas não aprovam nem exibem percentual final',()=>{
 const r=reviews();delete r.conv_49;const d=gateADecision(calls,r);
 assert.equal(d.decisao,'pendente');assert.equal(d.percentual,null);assert.equal(d.pendentes,1);
});
test('sem escuta, identidade, evidência ou data não há referência humana completa',()=>{
 for(const patch of [{audio_ouvido:false},{revisor:''},{evidencia:' '},{revisado_em:'x'},{resultado_humano:'nao_auditavel'}]){
  const r=reviews();Object.assign(r.conv_0,patch);assert.equal(gateADecision(calls,r).decisao,'pendente');
 }
});
test('áudio indisponível não reduz denominador e ausência de veredito robô não é acerto',()=>{
 const r=reviews();r.conv_0.resultado_humano='nao_auditavel';
 assert.equal(gateADecision(calls,r).total,50);assert.equal(gateADecision(calls,r).indisponiveis,1);
 const changed=structuredClone(calls);changed[0].resultado=null;assert.equal(gateADecision(changed,reviews()).erros,1);
});
test('tamanho e identidade da amostra são obrigatórios',()=>{
 assert.throws(()=>gateADecision(calls.slice(1),{}));
 assert.throws(()=>gateADecision([...calls.slice(1),calls[1]],{}));
});
test('sorteio é reproduzível, sem reposição e independente da ordem ou dos vereditos',()=>{
 const population=Array.from({length:218},(_,i)=>({conversation_id:`conv_${i}`,resultado:i%2?'confirmado':'sem_atendimento'}));
 const seed='a'.repeat(64),ids=x=>x.map(c=>c.conversation_id);
 const chosen=sampleCalls(population,seed);
 assert.equal(chosen.length,50);assert.equal(new Set(ids(chosen)).size,50);
 assert.deepEqual(ids(chosen),ids(sampleCalls(population.slice().reverse(),seed)));
 assert.deepEqual(ids(chosen),ids(sampleCalls(population.map(c=>({...c,resultado:'inconclusivo'})),seed)));
 assert.notDeepEqual(ids(chosen),ids(sampleCalls(population,'b'.repeat(64))));
});
test('sorteio rejeita população pequena, duplicada, ID inseguro ou semente inválida',()=>{
 for(const pop of [calls.slice(1),[...calls,calls[0]],calls.map((c,i)=>i?c:{...c,conversation_id:"x');drop"})])
  assert.throws(()=>sampleCalls(pop,'a'.repeat(64)));
 assert.throws(()=>sampleCalls(calls,'seed'));
});
test('detalhes precisam corresponder exatamente às 50 chamadas e ao veredito congelado',()=>{
 const manifest={calls};assert.equal(combineDetails(manifest,calls).length,50);
 assert.throws(()=>combineDetails(manifest,calls.slice(1)));
 const changed=structuredClone(calls);changed[0].resultado='sem_atendimento';assert.throws(()=>combineDetails(manifest,changed));
 const replaced=structuredClone(calls);replaced[0].conversation_id='conv_other';assert.throws(()=>combineDetails(manifest,replaced));
});

test('checkpoint preserva rascunhos sem atribuir autoria ou concluir avaliações',()=>{
 const packet={sample_id:'sample',calls};
 const draft={...reviews().conv_0,revisor:''};
 const source={sample_id:'sample',revisor:'',reviews:{conv_0:draft}};
 const restored=mergeGateAReviews(packet,source);
 assert.deepEqual(restored,source);assert.notEqual(restored.reviews.conv_0,draft);
 assert.equal(gateADecision(calls,restored.reviews).revisadas,0);
});
test('mescla mantém revisões exclusivas e a edição mais recente em qualquer ordem',()=>{
 const packet={sample_id:'sample',calls};const all=reviews();
 const older={sample_id:'sample',reviews:{conv_0:all.conv_0,conv_1:all.conv_1}};
 const newer={sample_id:'sample',reviews:{conv_0:{...all.conv_0,evidencia:'Edição recente',revisado_em:'2026-10-03T15:00:00Z'},conv_2:all.conv_2}};
 for(const sources of [[older,newer],[newer,older]]){
  const r=mergeGateAReviews(packet,...sources);
  assert.equal(Object.keys(r.reviews).length,3);assert.equal(r.reviews.conv_0.evidencia,'Edição recente');
 }
});
test('checkpoint rejeita outra amostra, outra população e chamadas desconhecidas',()=>{
 const packet={sample_id:'sample',population_sha256:'population',prompt_hash:'prompt',calls};
 for(const source of [
  {sample_id:'other',reviews:{}},{sample_id:'sample',population_sha256:'other',reviews:{}},
  {sample_id:'sample',prompt_hash:'other',reviews:{}},{sample_id:'sample',reviews:[]},
  {sample_id:'sample',reviews:{conv_unknown:reviews().conv_0}},
  {sample_id:'sample',reviews:{conv_0:{...reviews().conv_0,audio_ouvido:'true'}}}
 ])assert.throws(()=>mergeGateAReviews(packet,source));
});
