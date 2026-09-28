// SON-2.11 — o módulo que guarda a conversa.
//
// A suíte da edge (tests/runtime/webhook_test.ts) prova que o webhook grava. O
// que se prova AQUI são as bordas do payload: a ElevenLabs manda transcript
// ausente, turno sem texto, duração absurda e timestamp inválido, e nenhuma
// dessas coisas pode derrubar o webhook — porque derrubar o webhook hoje
// significa perder o veredito e o opt-out junto.

import assert from "node:assert/strict";
import test from "node:test";
import {
  gravarConversa,
  inicioEmIso,
  montarLinha,
  normalizarTranscript,
} from "../backend/edge-functions/_shared/ldr-conversa.ts";

const META = { start_time_unix_secs: 1800000000, call_duration_secs: 42 };

test("transcript: agent vira robo, o resto vira empresa", () => {
  assert.deepEqual(
    normalizarTranscript([
      { role: "agent", message: "Oi", time_in_call_secs: 0 },
      { role: "user", message: "Pois não", time_in_call_secs: 4 },
      { role: "qualquer_outro", message: "?", time_in_call_secs: 9 },
    ]),
    [
      { role: "robo", mensagem: "Oi", seg: 0 },
      { role: "empresa", mensagem: "Pois não", seg: 4 },
      { role: "empresa", mensagem: "?", seg: 9 },
    ],
  );
});

test("transcript malformado vira lista vazia, nunca exceção", () => {
  // Cada um destes já seria suficiente para derrubar o webhook se o módulo
  // confiasse no formato — e o webhook caindo perde o opt-out junto.
  for (const ruim of [null, undefined, "", 0, {}, { transcript: [] }]) {
    assert.deepEqual(normalizarTranscript(ruim), [], String(ruim));
  }
});

test("turno sem texto ou sem tempo não some: vira string vazia e seg nulo", () => {
  assert.deepEqual(
    normalizarTranscript([{ role: "agent" }, { role: "user", message: 42, time_in_call_secs: "x" }]),
    [
      { role: "robo", mensagem: "", seg: null },
      { role: "empresa", mensagem: "", seg: null },
    ],
  );
  // Perder a fala é aceitável; perder o TURNO não — some a contagem de quem
  // falou quantas vezes, que é insumo da SON-6.8.
  assert.equal(normalizarTranscript([{ role: "agent" }, { role: "user" }]).length, 2);
});

test("início: segundos unix viram ISO; lixo vira null", () => {
  assert.equal(inicioEmIso({ start_time_unix_secs: 1800000000 }), "2027-01-15T08:00:00.000Z");
  for (const ruim of [{}, { start_time_unix_secs: 0 }, { start_time_unix_secs: -5 },
                      { start_time_unix_secs: "1800000000" }, { start_time_unix_secs: NaN }]) {
    assert.equal(inicioEmIso(ruim), null, JSON.stringify(ruim));
  }
});

test("duração fora da faixa do CHECK vira null em vez de derrubar o insert", () => {
  // A 0392 tem `check (duracao_seg >= 0 and duracao_seg < 86400)`. Mandar um
  // valor fora disso faria o banco recusar a linha inteira — e aí a conversa
  // se perderia por causa de um campo secundário.
  for (const ruim of [-1, 86400, 999999, "42", null, undefined, NaN, Infinity]) {
    const l = montarLinha({ metadata: { call_duration_secs: ruim } },
      { conversationId: "c1", origem: "webhook" });
    assert.equal(l.duracao_seg, null, String(ruim));
  }
  assert.equal(montarLinha({ metadata: { call_duration_secs: 42.7 } },
    { conversationId: "c1", origem: "webhook" }).duracao_seg, 42, "trunca, não arredonda");
  assert.equal(montarLinha({ metadata: { call_duration_secs: 0 } },
    { conversationId: "c1", origem: "webhook" }).duracao_seg, 0, "zero é duração válida");
});

test("montarLinha carrega correlação, veredito e custo sem inventar nada", () => {
  const l = montarLinha(
    { agent_id: "agent_x", status: "done", metadata: META, transcript: [{ role: "agent", message: "oi" }] },
    { conversationId: "conv_1", origem: "backfill", telefoneId: "t1", leadId: "l1",
      resultado: "confirmado", custoValor: 0.12, custoUnidade: "USD" },
  );
  assert.equal(l.conversation_id, "conv_1");
  assert.equal(l.origem, "backfill");
  assert.equal(l.telefone_id, "t1");
  assert.equal(l.lead_id, "l1");
  assert.equal(l.agent_id, "agent_x");
  assert.equal(l.resultado, "confirmado");
  assert.equal(l.custo_valor, 0.12);
  assert.equal(l.transcript.length, 1);

  // Sem os extras, tudo nulo — e nenhum campo inventado.
  const vazia = montarLinha({}, { conversationId: "conv_2", origem: "webhook" });
  for (const campo of ["telefone_id", "lead_id", "agent_id", "status",
                       "iniciada_em", "duracao_seg", "resultado", "custo_valor", "custo_unidade"]) {
    assert.equal(vazia[campo], null, campo);
  }
  assert.deepEqual(vazia.transcript, []);
});

test("metadados guardam o bloco do evento sem duplicar o transcript", () => {
  const l = montarLinha(
    { metadata: { ...META, prompt_version: "v3.1" }, analysis: { transcript_summary: "resumo" },
      transcript: [{ role: "agent", message: "oi" }] },
    { conversationId: "c1", origem: "webhook" },
  );
  assert.equal(l.metadados.metadata.prompt_version, "v3.1", "SON-2.10 mora aqui");
  assert.equal(l.metadados.analysis.transcript_summary, "resumo");
  assert.equal("transcript" in l.metadados, false, "transcript tem coluna própria");
});

// ---------------------------------------------------------------------------
function clienteFalso(erro = null) {
  const chamadas = [];
  return {
    chamadas,
    from(tabela) {
      return {
        upsert(linha, opts) {
          chamadas.push({ tabela, linha, opts });
          return Promise.resolve({ error: erro });
        },
      };
    },
  };
}

test("com conteúdo substitui; sem conteúdo nunca sobrescreve", () => {
  const comTurnos = clienteFalso();
  return gravarConversa(comTurnos, montarLinha(
    { transcript: [{ role: "agent", message: "oi" }] },
    { conversationId: "c1", origem: "webhook" },
  )).then(async (r) => {
    assert.equal(r.ok, true);
    assert.equal(comTurnos.chamadas[0].tabela, "np_ldr_conversas");
    assert.equal(comTurnos.chamadas[0].opts.onConflict, "conversation_id");
    assert.equal(comTurnos.chamadas[0].opts.ignoreDuplicates, false);

    // Reentrega vazia: cria se não existe, mas jamais apaga o que já está lá.
    const semTurnos = clienteFalso();
    await gravarConversa(semTurnos, montarLinha({}, { conversationId: "c1", origem: "webhook" }));
    assert.equal(semTurnos.chamadas[0].opts.ignoreDuplicates, true);
  });
});

test("erro do banco é devolvido com motivo, não engolido", async () => {
  const r = await gravarConversa(clienteFalso({ message: "banco fora" }),
    montarLinha({}, { conversationId: "c1", origem: "webhook" }));
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "banco fora");
});
