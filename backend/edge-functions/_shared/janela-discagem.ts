// SON-1.6 — o portão que impede o robô de ligar fora de hora.
//
// R3: 9h–20h em dia útil, 9h–13h no sábado, nada no domingo nem em feriado
// nacional. O horário é sempre o de QUEM RECEBE, derivado do DDD.
//
// ---------------------------------------------------------------------------
// POR QUE ISTO É UM MÓDULO, E NÃO CÓDIGO DENTRO DO LAÇO
//
// O card manda inserir o portão no `for` do orquestrador. Só que o último item
// do checklist da SON-1.8 é "o disparo direto antigo foi desligado": esse `for`
// vai morrer e o disparo passa para o worker da fila. Escrito inline, este
// portão teria de ser escrito duas vezes — e portão duplicado é portão que
// diverge. Aqui ele é uma função pura, sem banco e sem rede, que o laço de hoje
// e o worker de amanhã importam igual, com o mesmo teste valendo para os dois.
//
// ---------------------------------------------------------------------------
// O QUE ESTE MÓDULO NÃO DECIDE
//
// Os horários vêm da R3, já escritos no documento-fonte. Traduzir não é
// redecidir. Duas escolhas de implementação, que ficam explícitas para não
// virarem opinião escondida:
//
//   1. O fim da janela é EXCLUSIVO: 19h59 liga, 20h00 não. "Até as 20h" com
//      20h00:00 valendo abriria um minuto de discagem depois do fim declarado.
//   2. Carnaval e Corpus Christi NÃO bloqueiam. Não são feriado nacional: são
//      ponto facultativo (a Lei 9.093/1995 lista os nacionais, e eles não estão
//      lá). A R3 diz "feriado nacional", então é isso que está implementado. Se
//      a operação quiser bloquear os facultativos também, é uma decisão de
//      negócio — passe `bloquearFacultativos: true`.
// ===========================================================================

/** DDDs fora de UTC-3. O Brasil tem 4 fusos; o padrão é Brasília. */
const DDD_UTC_MENOS_4 = new Set([
  "65", "66", // MT
  "67", // MS
  "69", // RO
  "92", "97", // AM
  "95", // RR
]);
const DDD_UTC_MENOS_5 = new Set(["68"]); // AC

/**
 * Fernando de Noronha é UTC-2 e usa DDD 81, o mesmo de Recife. Não há como
 * separar os dois pelo número, então um lead de Noronha é tratado como UTC-3 e
 * a janela termina 1h depois da hora local dele. É limitação conhecida e
 * assumida: a base industrial de Noronha é vazia. Se um dia deixar de ser,
 * o desempate tem de vir do endereço, não do DDD.
 */

export type MotivoForaDeJanela =
  | "domingo"
  | "feriado_nacional"
  | "antes_da_abertura"
  | "depois_do_fechamento"
  | "sabado_fora_da_janela_menor"
  | "telefone_invalido";

export type Veredito = {
  /** true só quando pode discar agora. Nunca é nulo: fail-closed por construção. */
  pode: boolean;
  /** Sempre preenchido, inclusive quando libera. Recusa em silêncio não audita. */
  motivo: string;
  codigo: MotivoForaDeJanela | "dentro_da_janela";
  /** Fuso derivado do DDD, como offset de horas em relação a UTC. */
  offsetHoras: number;
  ddd: string;
  /** Data e hora no fuso de quem recebe, ISO curto, para o motivo ser conferível. */
  horaLocal: string;
  /** 0 = domingo … 6 = sábado, no fuso do lead. */
  diaSemana: number;
  feriado: string | null;
};

export type OpcoesJanela = {
  /** Carnaval (seg/ter) e Corpus Christi. Não são feriado nacional; default false. */
  bloquearFacultativos?: boolean;
};

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function dddDe(e164: unknown): string {
  const digitos = String(e164 ?? "").replace(/\D/g, "");
  if (!digitos.startsWith("55") || digitos.length < 4) return "";
  return digitos.slice(2, 4);
}

export function offsetDoDdd(ddd: string): number {
  if (DDD_UTC_MENOS_4.has(ddd)) return -4;
  if (DDD_UTC_MENOS_5.has(ddd)) return -5;
  return -3;
}

/**
 * Páscoa pelo algoritmo de Meeus/Butcher (calendário gregoriano). É o que
 * permite a Sexta-feira Santa sair calculada em vez de virar uma lista fixa
 * que expira sem ninguém perceber no ano seguinte.
 */
export function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

function somarDias(ano: number, mes: number, dia: number, delta: number) {
  const d = new Date(Date.UTC(ano, mes - 1, dia + delta));
  return { mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

/**
 * Feriados nacionais (Lei 9.093/1995 + Lei 14.759/2023, que tornou o 20 de
 * novembro nacional a partir de 2024). Calculados por ano: nada de tabela que
 * envelhece.
 */
export function feriadosNacionais(ano: number): Map<string, string> {
  const mapa = new Map<string, string>();
  const por = (mes: number, dia: number, nome: string) =>
    mapa.set(`${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`, nome);

  por(1, 1, "Confraternização Universal");
  por(4, 21, "Tiradentes");
  por(5, 1, "Dia do Trabalho");
  por(9, 7, "Independência");
  por(10, 12, "Nossa Senhora Aparecida");
  por(11, 2, "Finados");
  por(11, 15, "Proclamação da República");
  por(12, 25, "Natal");
  // Nacional só a partir de 2024 (Lei 14.759/2023). Antes disso era estadual
  // ou municipal, e datar errado um feriado é o mesmo erro que não ter lista.
  if (ano >= 2024) por(11, 20, "Consciência Negra");

  const p = pascoa(ano);
  const sexta = somarDias(ano, p.mes, p.dia, -2);
  por(sexta.mes, sexta.dia, "Sexta-feira Santa");

  return mapa;
}

/** Carnaval e Corpus Christi: ponto facultativo, não feriado nacional. */
export function facultativosNacionais(ano: number): Map<string, string> {
  const mapa = new Map<string, string>();
  const por = (d: { mes: number; dia: number }, nome: string) =>
    mapa.set(`${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`, nome);
  const p = pascoa(ano);
  por(somarDias(ano, p.mes, p.dia, -48), "Carnaval (segunda)");
  por(somarDias(ano, p.mes, p.dia, -47), "Carnaval (terça)");
  por(somarDias(ano, p.mes, p.dia, 60), "Corpus Christi");
  return mapa;
}

const ABRE = 9;
const FECHA_UTIL = 20;   // exclusivo: 19h59 liga, 20h00 não
const FECHA_SABADO = 13; // exclusivo

/**
 * O veredito. `agora` é injetável para o teste cobrir virada de dia, sábado,
 * domingo e feriado sem depender do relógio de quem roda a suíte.
 */
export function janelaDeDiscagem(
  e164: unknown,
  agora: Date = new Date(),
  opcoes: OpcoesJanela = {},
): Veredito {
  const ddd = dddDe(e164);
  if (!ddd) {
    // Sem DDD não dá para saber o fuso, e sem fuso não dá para afirmar que
    // está dentro da janela. Fail-closed: entrada ruim vira recusa, não exceção.
    return {
      pode: false,
      motivo: `telefone sem DDD reconhecível (${String(e164 ?? "nulo")}) — sem fuso não dá para saber a hora de quem recebe`,
      codigo: "telefone_invalido",
      offsetHoras: -3,
      ddd: "",
      horaLocal: "",
      diaSemana: -1,
      feriado: null,
    };
  }

  const offsetHoras = offsetDoDdd(ddd);
  const local = new Date(agora.getTime() + offsetHoras * 3600_000);
  const ano = local.getUTCFullYear();
  const mes = local.getUTCMonth() + 1;
  const dia = local.getUTCDate();
  const hora = local.getUTCHours();
  const minuto = local.getUTCMinutes();
  const diaSemana = local.getUTCDay();
  const chave = `${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const horaLocal =
    `${ano}-${chave} ${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
  const onde = `${horaLocal} no fuso do DDD ${ddd} (UTC${offsetHoras})`;

  const feriado = feriadosNacionais(ano).get(chave) ?? null;
  const facultativo = opcoes.bloquearFacultativos
    ? facultativosNacionais(ano).get(chave) ?? null
    : null;

  const base = { offsetHoras, ddd, horaLocal, diaSemana, feriado: feriado ?? facultativo };

  if (feriado || facultativo) {
    return {
      ...base,
      pode: false,
      motivo: `${feriado ? "feriado nacional" : "ponto facultativo"}: ${feriado ?? facultativo} — ${onde}`,
      codigo: "feriado_nacional",
    };
  }

  if (diaSemana === 0) {
    return { ...base, pode: false, motivo: `domingo — ${onde}`, codigo: "domingo" };
  }

  const fecha = diaSemana === 6 ? FECHA_SABADO : FECHA_UTIL;

  if (hora < ABRE) {
    return {
      ...base,
      pode: false,
      motivo: `antes das ${ABRE}h — ${onde}`,
      codigo: "antes_da_abertura",
    };
  }

  if (hora >= fecha) {
    return {
      ...base,
      pode: false,
      motivo: diaSemana === 6
        ? `sábado só até as ${FECHA_SABADO}h — ${onde}`
        : `depois das ${FECHA_UTIL}h — ${onde}`,
      codigo: diaSemana === 6 ? "sabado_fora_da_janela_menor" : "depois_do_fechamento",
    };
  }

  return {
    ...base,
    pode: true,
    motivo: `dentro da janela (${DIAS[diaSemana]}, ${ABRE}h–${fecha}h) — ${onde}`,
    codigo: "dentro_da_janela",
  };
}
