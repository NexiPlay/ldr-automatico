import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTranscriptPolicy } from '../scripts/ldr-transcript.mjs';
const item = {id:'abertura',dynamic_variables:{empresa:'Oficina Horizonte'}};
const intro = 'Sou Bruno, assistente virtual da Tendência Energia. Esta ligação está sendo gravada. Estou ligando para confirmar a empresa deste telefone e saber quem cuida de energia.';
const turn = (role,message) => ({role,message});
const end = message => ({role:'agent',message,tool_calls:[{tool_name:'end_call',params_as_json:JSON.stringify({system__message_to_speak:message})}]});
test('transcrição aceita R5 seguido de pergunta, resposta e ferramenta', () => {
  assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oficina Horizonte, recepção.'),turn('agent',intro+' Você pode informar o nome de quem cuida de energia?'),turn('user','Paula'),end('Obrigado pela atenção. Até logo.')],item);
});
test('transcrição barra aprovação automática com pergunta no encerramento', () => {
  assert.throws(()=>assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oi'),turn('agent',intro),end('Quem cuida de energia?')],item),/pergunta dentro/);
});
test('transcrição barra despedida seguida de nova fala do cliente e pedido repetido', () => {
  assert.throws(()=>assertTranscriptPolicy([turn('agent',intro),turn('agent','Vou encerrar. Até logo.'),turn('user','Espera'),end('Até logo.')],item),/após despedida/);
  assert.throws(()=>assertTranscriptPolicy([turn('agent',intro+' Quem cuida de energia?'),turn('user','Quanto custa?'),turn('agent','Pode informar o nome do responsável?'),end('Até logo.')],item),/repetido/);
});
test('transcrição barra ausência de R5 e pergunta sem referência, mas aceita recusa imediata', () => {
  assert.throws(()=>assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oi'),end('Obrigado.')],item),/R5/);
  assert.throws(()=>assertTranscriptPolicy([turn('agent',intro+' Aqui é da?'),end('Até logo.')],{...item,dynamic_variables:{empresa:''}}),/sem referência/);
  assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Não vou passar informações.'),end('Entendido. Até logo.')],item);
});

const focusPolicy='greeting_then_company_check';
const shortIntro='Sou Bruno, assistente virtual da Tendência Energia.';
const focusItem={...item,empresa_primeiro:true};
const questionPolicy='greeting_then_company_question';
test('pergunta primeiro: abertura direta, identificação só antes do responsável',()=>{
  const head=[turn('agent','Alô?'),turn('user','Oi'),turn('agent','Falo com a Oficina Horizonte?'),turn('user','Sim, pode perguntar')];
  assertTranscriptPolicy([...head,turn('agent',shortIntro+' Quem cuida da energia aí?'),turn('user','Paula'),end('Obrigado.')],focusItem,questionPolicy);
  assert.throws(()=>assertTranscriptPolicy([...head,turn('agent','Quem cuida da energia aí?'),turn('user','Paula'),end('Obrigado.')],focusItem,questionPolicy),/antes de se identificar/);
  assert.throws(()=>assertTranscriptPolicy([turn('user','Oi'),turn('agent',shortIntro+' Falo com a Oficina Horizonte?'),turn('user','Sim'),end('Obrigado.')],focusItem,questionPolicy),/apresentação antes/);
});
test('pergunta primeiro: quem fala exige resposta transparente',()=>{
  assertTranscriptPolicy([turn('user','Quem fala?'),turn('agent',shortIntro+' Falo com a Oficina Horizonte?'),turn('user','Sim'),end('Obrigado.')],focusItem,questionPolicy);
  assert.throws(()=>assertTranscriptPolicy([turn('user','Quem fala?'),turn('agent','Falo com a Oficina Horizonte?'),turn('user','Sim'),end('Obrigado.')],focusItem,questionPolicy),/solicitada ausente/);
});
test('pergunta primeiro: confirmação simples pode encerrar sem apresentação',()=>{
  assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oi'),turn('agent','Falo com a Oficina Horizonte?'),turn('user','Sim'),end('Obrigado pela confirmação.')],{...focusItem,responsavel_permitido:false},questionPolicy);
});
test('empresa primeiro: confirmação simples encerra sem responsável',()=>{
  assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oi'),turn('agent',shortIntro+' Falo com a Oficina Horizonte?'),turn('user','Sim'),end('Obrigado.')],{...focusItem,responsavel_permitido:false},focusPolicy);
});
test('empresa primeiro: responsável antes da confirmação e sem abertura reprovam',()=>{
  assert.throws(()=>assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Financeiro, quem fala?'),turn('agent',shortIntro+' Quem cuida da energia aí?'),end('Obrigado.')],focusItem,focusPolicy),/antes de confirmar/);
  assert.throws(()=>assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oi'),turn('agent',shortIntro+' Falo com a Oficina Horizonte?'),turn('user','Sim'),turn('agent','Quem cuida da energia aí?'),end('Obrigado.')],{...focusItem,responsavel_permitido:false},focusPolicy),/sem abertura/);
});
test('empresa primeiro: depois da confirmação com abertura aceita uma pergunta',()=>{
  assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oi'),turn('agent',shortIntro+' Falo com a Oficina Horizonte?'),turn('user','Sim, pode perguntar'),turn('agent','Quem cuida da energia aí?'),turn('user','Paula'),end('Obrigado.')],focusItem,focusPolicy);
});
test('empresa primeiro: aviso técnico termina sem apresentação ou perguntas',()=>{
  const head=[turn('agent','Alô?'),turn('user','O destino não está acessível. 3CX cannot reach the destination.')];
  assertTranscriptPolicy([...head,end('')],item,focusPolicy);
  assert.throws(()=>assertTranscriptPolicy([...head,end(shortIntro+' Obrigado.')],item,focusPolicy),/mensagem automática/);
});
test('empresa primeiro: não anuncia gravação, mas responde com verdade se perguntado',()=>{
  assert.throws(()=>assertTranscriptPolicy([turn('user','Oi'),turn('agent',intro),end('Obrigado.')],item,focusPolicy),/gravação não solicitado/);
  assertTranscriptPolicy([turn('user','Você está gravando?'),end(shortIntro+' Sim, esta ligação está sendo gravada.')],item,focusPolicy);
});
test('empresa primeiro: fala longa continua bloqueada mesmo com identidade correta',()=>{
  assert.throws(()=>assertTranscriptPolicy([turn('user','Oi'),turn('agent',shortIntro+' palavra'.repeat(45)),end('Obrigado.')],item,focusPolicy),/fala longa/);
});

test('empresa primeiro: fala de end_call sem espelho também é validada',()=>{
const toolOnly=message=>({...end(message),message:null});
assertTranscriptPolicy([turn('agent','Alô?'),turn('user','Oficina Horizonte, Paula cuida da energia.'),toolOnly(shortIntro+' Obrigado.')],item,focusPolicy);
assert.throws(()=>assertTranscriptPolicy([turn('user','Oi'),toolOnly(shortIntro+' palavra'.repeat(45))],item,focusPolicy),/fala longa/);
});
