// SON-1.6 — o portão de janela dentro da edge, não só na função pura.
//
// O módulo `_shared/janela-discagem.ts` tem a sua própria suíte de bordas
// (tests/janela-discagem.test.mjs). O que se prova AQUI é outra coisa: que o
// orquestrador consulta o portão antes de discar, que a recusa sai com motivo
// no corpo da resposta, e — o que mais importa — que **nenhum POST de discagem
// sai** quando está fora de hora. Um portão que recusa depois de ligar não é
// portão.

import assert from "node:assert/strict";
import { withEdge, type Query, type Result } from "./harness.ts";

const SP = "+5511988887777";
const ACRE = "+5568988887777";

/**
 * Responde ao que a edge precisa ANTES do laço (a origem de telefonia) e
 * marca se o POST de discagem chegou a sair. O GET do agente devolve 500 de
 * propósito: tudo que vem depois do portão está fora do escopo deste arquivo,
 * e um erro ali vira `falhas`, não `pulados` — o que mantém as asserções de
 * `pulados` medindo só a janela.
 */
function stubFetch(marcar: () => void) {
  return ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/phone-numbers/")) {
      return Promise.resolve(
        Response.json({ phone_number_id: "test-phone", phone_number: "+5511000000010" }),
      );
    }
    if (url.includes("/sip-trunk/outbound-call")) {
      marcar();
      return Promise.resolve(Response.json({ success: false, message: "não deveria" }, { status: 500 }));
    }
    return Promise.resolve(new Response("", { status: 500 }));
  }) as unknown as typeof fetch;
}

function dbCom(e164: string, aoLerBriefing?: () => void) {
  return (q: Query): Result => {
    if (q.table === "np_lead_telefones" && q.limit === 0) return { data: [], error: null };
    if (q.table === "np_lead_telefones" && q.action === "select") {
      return {
        error: null,
        data: {
          id: q.filters[0][2], lead_id: "lead-1", e164, ia_tentativas: 0,
          ia_conversation_id: null,
          np_leads: { nome_exibicao: "METALURGICA TESTE LTDA", cnpj: "12345678000195" },
        },
      };
    }
    if (q.table === "np_lead_enriquecimento") {
      aoLerBriefing?.();
      return { data: null, error: null };
    }
    if (q.table === "np_lead_telefones" && q.action === "update") return { data: {}, error: null };
    throw new Error(`Consulta inesperada: ${q.table} ${q.action}`);
  };
}

type Saida = {
  corpo: Record<string, unknown>;
  discou: boolean;
  leuBriefing: boolean;
  rpcs: string[];
};

async function rodar(iso: string, e164 = SP): Promise<Saida> {
  let corpo!: Record<string, unknown>;
  let discou = false;
  let leuBriefing = false;
  const rpcs: string[] = [];
  await withEdge("ldr-automatico-orquestrador", {
    db: dbCom(e164, () => { leuBriefing = true; }),
    agora: new Date(iso),
    rpc(name: string) {
      rpcs.push(name);
      if (name === "np_fn_sonar_reputacao_portao") return { data: { permitido: true }, error: null };
      return { data: true, error: null };
    },
    fetch: stubFetch(() => { discou = true; }),
  }, async (handle) => {
    const res = await handle(new Request("https://edge.invalid", {
      method: "POST",
      body: JSON.stringify({ telefone_ids: ["phone-1"] }),
    }));
    corpo = await res.json();
  });
  return { corpo, discou, leuBriefing, rpcs };
}

function pulado(corpo: Record<string, unknown>) {
  const pulados = corpo.pulados as Array<Record<string, unknown>>;
  assert.equal(pulados.length, 1, `esperava 1 pulado, veio ${JSON.stringify(pulados)}`);
  return pulados[0];
}

// ---------------------------------------------------------------------------
Deno.test("fora da janela: recusa com motivo e nenhuma discagem sai", async () => {
  // 03h da manhã de uma quarta-feira em São Paulo.
  const r = await rodar("2026-09-30T06:00:00.000Z");
  assert.equal(r.discou, false, "nada pode ser discado fora de hora");
  assert.equal(r.leuBriefing, false, "nem chega a montar o briefing");

  const p = pulado(r.corpo);
  assert.equal(p.motivo, "fora_de_janela");
  assert.equal(p.codigo, "antes_da_abertura");
  assert.equal(p.horaLocal, "2026-09-30 03:00");
  assert.equal(p.ddd, "11");
  assert.match(String(p.detalhe), /antes das 9h/);
  assert.equal((r.corpo.ligados as unknown[]).length, 0);
});

Deno.test("domingo e feriado nacional barram, cada um com o seu motivo", async () => {
  const domingo = await rodar("2026-10-04T17:00:00.000Z"); // domingo, 14h
  assert.equal(domingo.discou, false);
  assert.equal(pulado(domingo.corpo).codigo, "domingo");

  // Natal de 2026 cai numa sexta: dia útil, 14h, e mesmo assim não.
  const natal = await rodar("2026-12-25T17:00:00.000Z");
  assert.equal(natal.discou, false, "erro de calendário também é erro");
  const p = pulado(natal.corpo);
  assert.equal(p.codigo, "feriado_nacional");
  assert.match(String(p.detalhe), /Natal/);
});

Deno.test("sábado: 14h barra, 10h passa", async () => {
  const tarde = await rodar("2026-10-03T17:00:00.000Z"); // sábado 14h
  assert.equal(tarde.discou, false);
  assert.equal(pulado(tarde.corpo).codigo, "sabado_fora_da_janela_menor");

  // 10h do mesmo sábado: o portão libera e o fluxo continua. Quem interrompe
  // depois é o GET do agente (500 no stub) — e é justamente isso que prova
  // que a janela deixou passar em vez de barrar.
  const manha = await rodar("2026-10-03T13:00:00.000Z");
  assert.equal(manha.leuBriefing, true, "10h de sábado está dentro da janela menor");
  assert.equal((manha.corpo.pulados as unknown[]).length, 0, "nada foi barrado pela janela");
});

Deno.test("o portão roda antes do opt-out: fora de hora não custa RPC", async () => {
  const r = await rodar("2026-09-30T06:00:00.000Z"); // 03h
  assert.equal(r.rpcs.includes("np_fn_pode_contatar"), false,
    "a janela é computação pura; número fora de hora nem consulta o opt-out");
});

Deno.test("o fuso vem do DDD também dentro da edge", async () => {
  // 12h30 UTC = 9h30 em São Paulo (abre) e 7h30 no Acre (fechado). Mesmo
  // instante, telefones diferentes, vereditos diferentes.
  const sp = await rodar("2026-09-30T12:30:00.000Z", SP);
  assert.equal((sp.corpo.pulados as unknown[]).length, 0, "9h30 em São Paulo passa");
  assert.equal(sp.leuBriefing, true);

  const ac = await rodar("2026-09-30T12:30:00.000Z", ACRE);
  const p = pulado(ac.corpo);
  assert.equal(p.motivo, "fora_de_janela", "7h30 no Acre, não");
  assert.equal(p.horaLocal, "2026-09-30 07:30");
  assert.equal(p.ddd, "68");
  assert.equal(ac.discou, false);
});
