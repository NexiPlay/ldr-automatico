// SON-1.6 — o portão de janela dentro da edge.
//
// O QUE ESTE ARQUIVO PROVA, E O QUE MUDOU EM 30/09/2026
//
// Até a SON-2.2 a R3 era calculada em TypeScript aqui dentro, e este arquivo
// misturava duas perguntas: "a regra está certa?" e "a edge respeita a regra?".
// A regra agora vive no banco (nexilead, migration 0406), e a correção dela é
// provada pela suíte SQL que roda na CI daquele repo
// (backend/tests/sql/test_0406_janela_r3.sql — os mesmos 13 casos de borda que
// rodavam aqui).
//
// Aqui sobra a segunda pergunta, que é a que importa nesta camada:
//   · o orquestrador CONSULTA o portão antes de discar;
//   · ele obedece ao veredito, qualquer que seja — não recalcula nada;
//   · a recusa sai com motivo no corpo da resposta;
//   · **nenhum POST de discagem sai** quando o portão barra. Portão que recusa
//     depois de ligar não é portão;
//   · portão indisponível BLOQUEIA (fail-closed). Ligar fora do horário
//     permitido é problema de conformidade, não de disponibilidade.
//
// Por isso os vereditos abaixo são fabricados: o teste não precisa saber que
// horas são, precisa provar que a edge faz o que a resposta mandar.

import assert from "node:assert/strict";
import { withEdge, type Query, type Result } from "./harness.ts";

const SP = "+5511988887777";
const RPC_JANELA = "np_fn_sonar_janela_discagem";

/** Um veredito como o banco devolve, com os campos que a edge repassa. */
function veredito(over: Record<string, unknown> = {}) {
  return {
    pode: true,
    codigo: "dentro_da_janela",
    motivo: "dentro da janela (9h-20h) — 2026-09-30 10:00 no fuso do DDD 11 (UTC-3)",
    ddd: "11",
    offset_horas: -3,
    hora_local: "2026-09-30 10:00",
    dia_semana: 3,
    feriado: null,
    ...over,
  };
}

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
    // Tudo depois do portão está fora do escopo deste arquivo: um erro aqui
    // vira `falhas`, não `pulados`, e mantém as asserções medindo só a janela.
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
  status: number;
  discou: boolean;
  leuBriefing: boolean;
  rpcs: string[];
};

/** `respostaJanela` decide o que o banco responde — inclusive falhar. */
async function rodar(
  respostaJanela: { data: unknown; error: unknown },
  e164 = SP,
): Promise<Saida> {
  let corpo!: Record<string, unknown>;
  let status = 0;
  let discou = false;
  let leuBriefing = false;
  const rpcs: string[] = [];
  await withEdge("ldr-automatico-orquestrador", {
    db: dbCom(e164, () => { leuBriefing = true; }),
    agora: new Date("2026-09-30T13:00:00.000Z"),
    rpc(name: string) {
      rpcs.push(name);
      if (name === RPC_JANELA) return respostaJanela;
      if (name === "np_fn_sonar_reputacao_portao") return { data: { permitido: true }, error: null };
      return { data: true, error: null };
    },
    fetch: stubFetch(() => { discou = true; }),
  }, async (handle) => {
    const res = await handle(new Request("https://edge.invalid", {
      method: "POST",
      body: JSON.stringify({ telefone_ids: ["phone-1"] }),
    }));
    status = res.status;
    corpo = await res.json();
  });
  return { corpo, status, discou, leuBriefing, rpcs };
}

function pulado(corpo: Record<string, unknown>) {
  const pulados = corpo.pulados as Array<Record<string, unknown>>;
  assert.equal(pulados.length, 1, `esperava 1 pulado, veio ${JSON.stringify(pulados)}`);
  return pulados[0];
}

// ---------------------------------------------------------------------------
Deno.test("a edge consulta o portão de janela no banco antes de discar", async () => {
  const r = await rodar({ data: veredito(), error: null });
  assert.ok(r.rpcs.includes(RPC_JANELA), "a janela tem de ser consultada no banco");
});

Deno.test("portão barra: recusa com motivo e nenhuma discagem sai", async () => {
  const r = await rodar({
    data: veredito({
      pode: false,
      codigo: "antes_da_abertura",
      motivo: "antes das 9h — 2026-09-30 03:00 no fuso do DDD 11 (UTC-3)",
      hora_local: "2026-09-30 03:00",
    }),
    error: null,
  });

  assert.equal(r.discou, false, "nada pode ser discado fora de hora");
  assert.equal(r.leuBriefing, false, "nem chega a montar o briefing");

  const p = pulado(r.corpo);
  assert.equal(p.motivo, "fora_de_janela");
  assert.equal(p.codigo, "antes_da_abertura", "o código do banco chega inteiro na resposta");
  assert.equal(p.horaLocal, "2026-09-30 03:00");
  assert.equal(p.ddd, "11");
  assert.match(String(p.detalhe), /antes das 9h/);
  assert.equal((r.corpo.ligados as unknown[]).length, 0);
});

Deno.test("a edge obedece ao veredito, não o recalcula", async () => {
  // Veredito impossível de deduzir do relógio: o instante injetado é uma quarta
  // às 10h de São Paulo, hora comercial. Se a edge ainda calculasse por conta
  // própria, ela liberaria — e este teste falharia.
  const r = await rodar({
    data: veredito({ pode: false, codigo: "domingo", motivo: "domingo — hora qualquer" }),
    error: null,
  });
  assert.equal(r.discou, false);
  assert.equal(pulado(r.corpo).codigo, "domingo");
});

Deno.test("portão libera: o fluxo segue e nada é barrado pela janela", async () => {
  const r = await rodar({ data: veredito({ pode: true }), error: null });
  assert.equal(r.leuBriefing, true, "liberado, o fluxo continua");
  assert.equal((r.corpo.pulados as unknown[]).length, 0, "nada foi barrado pela janela");
});

Deno.test("portão indisponível bloqueia o lote (fail-closed)", async () => {
  for (const resposta of [
    { data: null, error: { message: "timeout" } },          // o RPC falhou
    { data: null, error: null },                             // respondeu vazio
    { data: { codigo: "dentro_da_janela" }, error: null },   // respondeu sem veredito
  ]) {
    const r = await rodar(resposta);
    assert.equal(r.discou, false, "sem saber a hora de quem recebe, não se disca");
    assert.equal(r.status, 503, "o lote para e o chamador sabe por quê");
    assert.equal(r.corpo.janelaIndisponivel, true);
  }
});
