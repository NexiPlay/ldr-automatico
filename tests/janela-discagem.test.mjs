// SON-1.6 — o portão de janela de discagem.
//
// Todos os casos injetam `agora`: um teste de janela que depende do relógio de
// quem roda a suíte passa de manhã e falha de madrugada, e aí ninguém confia
// mais nele.
//
// Os quatro casos de borda exigidos pelo card estão aqui com nome próprio:
// virada de dia, sábado, domingo e feriado nacional.

import assert from "node:assert/strict";
import test from "node:test";
import {
  dddDe,
  facultativosNacionais,
  feriadosNacionais,
  janelaDeDiscagem,
  offsetDoDdd,
  pascoa,
} from "../backend/edge-functions/_shared/janela-discagem.ts";

const SP = "+5511999999999";   // UTC-3
const AC = "+5568999999999";   // UTC-5, Acre
const MT = "+5565999999999";   // UTC-4, Mato Grosso
const utc = (iso) => new Date(iso);

/** Atalho: só o par (pode, código). */
const v = (fone, iso, opts) => {
  const r = janelaDeDiscagem(fone, utc(iso), opts);
  return { pode: r.pode, codigo: r.codigo, motivo: r.motivo, hora: r.horaLocal };
};

// ---------------------------------------------------------------------------
test("o fuso vem do DDD, não do relógio de quem programou", () => {
  assert.equal(dddDe(SP), "11");
  assert.equal(dddDe("5511999999999"), "11");
  assert.equal(dddDe("11999999999"), "", "sem o 55 não dá para afirmar o país");
  assert.equal(offsetDoDdd("11"), -3);
  assert.equal(offsetDoDdd("65"), -4, "MT");
  assert.equal(offsetDoDdd("92"), -4, "AM");
  assert.equal(offsetDoDdd("68"), -5, "AC");

  // O caso que o card nomeia: 11h em Brasília é 9h no Acre. Os dois estão
  // dentro da janela. Mas 12h30 UTC é 9h30 em SP e 7h30 no Acre — e aí só um
  // pode receber ligação.
  assert.equal(v(SP, "2026-09-28T12:30:00Z").pode, true, "9h30 em São Paulo");
  assert.equal(v(AC, "2026-09-28T12:30:00Z").pode, false, "7h30 no Acre");
  assert.equal(v(AC, "2026-09-28T12:30:00Z").codigo, "antes_da_abertura");
  assert.equal(v(MT, "2026-09-28T12:30:00Z").pode, false, "8h30 em Mato Grosso");
});

test("o mesmo instante dá vereditos diferentes conforme o DDD", () => {
  // 23h30 UTC de segunda = 20h30 em SP (fechado) e 18h30 no Acre (aberto).
  const instante = "2026-09-28T23:30:00Z";
  assert.equal(v(SP, instante).pode, false);
  assert.equal(v(SP, instante).codigo, "depois_do_fechamento");
  assert.equal(v(AC, instante).pode, true);
});

// ---------------------------------------------------------------------------
test("borda: virada de dia (23h59 → 00h01) nunca libera", () => {
  assert.equal(v(SP, "2026-09-29T02:59:00Z").hora, "2026-09-28 23:59");
  assert.equal(v(SP, "2026-09-29T02:59:00Z").pode, false, "23h59 de segunda");
  assert.equal(v(SP, "2026-09-29T03:01:00Z").hora, "2026-09-29 00:01");
  assert.equal(v(SP, "2026-09-29T03:01:00Z").pode, false, "00h01 de terça");
  assert.equal(v(SP, "2026-09-29T03:01:00Z").codigo, "antes_da_abertura");
  // e às 9h em ponto do mesmo dia, abre
  assert.equal(v(SP, "2026-09-29T12:00:00Z").pode, true);
});

test("borda: o fim da janela é exclusivo — 19h59 liga, 20h00 não", () => {
  assert.equal(v(SP, "2026-09-28T22:59:00Z").pode, true, "19h59");
  assert.equal(v(SP, "2026-09-28T23:00:00Z").pode, false, "20h00 em ponto");
  assert.equal(v(SP, "2026-09-28T12:00:00Z").pode, true, "9h00 em ponto abre");
  assert.equal(v(SP, "2026-09-28T11:59:00Z").pode, false, "8h59 ainda não");
});

test("borda: sábado tem janela menor, 9h-13h", () => {
  // 2026-10-03 é sábado.
  assert.equal(v(SP, "2026-10-03T13:00:00Z").pode, true, "10h de sábado");
  assert.equal(v(SP, "2026-10-03T15:59:00Z").pode, true, "12h59");
  assert.equal(v(SP, "2026-10-03T16:00:00Z").pode, false, "13h00 em ponto");
  assert.equal(v(SP, "2026-10-03T16:00:00Z").codigo, "sabado_fora_da_janela_menor");
  assert.match(v(SP, "2026-10-03T16:00:00Z").motivo, /sábado só até as 13h/);
  // 17h de sábado seria dia útil, mas não é sábado
  assert.equal(v(SP, "2026-10-03T20:00:00Z").pode, false, "17h de sábado");
});

test("borda: domingo não tem janela nenhuma", () => {
  // 2026-10-04 é domingo.
  for (const h of ["12:00", "15:00", "20:00", "23:00"]) {
    const r = v(SP, `2026-10-04T${h}:00Z`);
    assert.equal(r.pode, false, `domingo ${h}Z`);
    assert.equal(r.codigo, "domingo");
  }
});

// ---------------------------------------------------------------------------
test("borda: feriado nacional — o caso que o card chama de erro de calendário", () => {
  // Natal de 2026 cai numa sexta: dia útil, hora comercial, e mesmo assim não.
  const natal = v(SP, "2026-12-25T15:00:00Z");
  assert.equal(natal.pode, false);
  assert.equal(natal.codigo, "feriado_nacional");
  assert.match(natal.motivo, /Natal/);

  // Um por mês fixo, todos em horário comercial.
  const fixos = [
    ["2026-01-01T15:00:00Z", /Confraterniza/],
    ["2026-04-21T15:00:00Z", /Tiradentes/],
    ["2026-05-01T15:00:00Z", /Trabalho/],
    ["2026-09-07T15:00:00Z", /Independ/],
    ["2026-10-12T15:00:00Z", /Aparecida/],
    ["2026-11-02T15:00:00Z", /Finados/],
    ["2026-11-15T15:00:00Z", /Proclama/],
  ];
  for (const [iso, re] of fixos) {
    const r = v(SP, iso);
    assert.equal(r.pode, false, iso);
    assert.match(r.motivo, re);
  }
});

test("feriado móvel: Sexta-feira Santa sai calculada, não de lista que expira", () => {
  // Páscoas conferidas em calendário: 2024=31/03, 2025=20/04, 2026=05/04, 2027=28/03.
  assert.deepEqual(pascoa(2024), { mes: 3, dia: 31 });
  assert.deepEqual(pascoa(2025), { mes: 4, dia: 20 });
  assert.deepEqual(pascoa(2026), { mes: 4, dia: 5 });
  assert.deepEqual(pascoa(2027), { mes: 3, dia: 28 });

  // Sexta-feira Santa = Páscoa - 2 dias, em cada ano.
  assert.equal(feriadosNacionais(2026).get("04-03"), "Sexta-feira Santa");
  assert.equal(feriadosNacionais(2027).get("03-26"), "Sexta-feira Santa");

  // E o portão respeita: 03/04/2026 é sexta, 11h da manhã.
  const r = v(SP, "2026-04-03T14:00:00Z");
  assert.equal(r.pode, false);
  assert.match(r.motivo, /Sexta-feira Santa/);
});

test("Consciência Negra só é nacional a partir de 2024 (Lei 14.759/2023)", () => {
  assert.equal(feriadosNacionais(2023).has("11-20"), false);
  assert.equal(feriadosNacionais(2024).get("11-20"), "Consciência Negra");
  assert.equal(v(SP, "2026-11-20T15:00:00Z").pode, false);
});

test("Carnaval e Corpus Christi NÃO bloqueiam por padrão — são facultativos", () => {
  // Carnaval 2026: 16 e 17 de fevereiro. Corpus Christi: 04 de junho.
  const carnaval = facultativosNacionais(2026);
  assert.equal(carnaval.get("02-16"), "Carnaval (segunda)");
  assert.equal(carnaval.get("02-17"), "Carnaval (terça)");
  assert.equal(carnaval.get("06-04"), "Corpus Christi");

  // Por padrão a terça de Carnaval é dia útil: a R3 fala em feriado NACIONAL.
  assert.equal(v(SP, "2026-02-17T15:00:00Z").pode, true);
  // Com a opção ligada, bloqueia e diz que é facultativo.
  const bloqueado = v(SP, "2026-02-17T15:00:00Z", { bloquearFacultativos: true });
  assert.equal(bloqueado.pode, false);
  assert.match(bloqueado.motivo, /ponto facultativo: Carnaval/);
});

// ---------------------------------------------------------------------------
test("entrada ruim vira recusa com motivo, nunca exceção", () => {
  for (const ruim of [null, undefined, "", "abc", "+1 415 555 0100", 12345, {}]) {
    const r = janelaDeDiscagem(ruim, utc("2026-09-28T15:00:00Z"));
    assert.equal(r.pode, false, String(ruim));
    assert.equal(r.codigo, "telefone_invalido");
    assert.ok(r.motivo.length > 0);
  }
});

test("todo veredito carrega motivo — inclusive quando libera", () => {
  const instantes = [
    "2026-09-28T15:00:00Z", "2026-09-28T02:00:00Z", "2026-10-03T13:00:00Z",
    "2026-10-04T15:00:00Z", "2026-12-25T15:00:00Z", "2026-04-03T14:00:00Z",
  ];
  for (const iso of instantes) {
    for (const fone of [SP, AC, MT]) {
      const r = janelaDeDiscagem(fone, utc(iso));
      assert.equal(typeof r.pode, "boolean", `${iso} ${fone}: pode nunca é nulo`);
      assert.ok(r.motivo && r.motivo.length > 10, `${iso} ${fone}: motivo legível`);
      assert.ok(r.horaLocal.includes(":"), "a hora de quem recebe fica no motivo");
      assert.ok(r.motivo.includes(r.horaLocal), "o motivo é conferível sem abrir o código");
    }
  }
});

test("a asserção acima depende mesmo da regra do feriado", () => {
  // Mutação: se o mapa de feriados vier vazio, o Natal passa a liberar. Se este
  // teste falhar, o teste do Natal acima virou decoração.
  const semFeriado = janelaDeDiscagem(SP, utc("2026-12-25T15:00:00Z"));
  assert.equal(semFeriado.pode, false);
  assert.equal(
    feriadosNacionais(2026).size > 0,
    true,
    "sem feriados no mapa, o teste do Natal passaria por acidente",
  );
});
