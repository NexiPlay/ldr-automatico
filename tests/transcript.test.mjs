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
