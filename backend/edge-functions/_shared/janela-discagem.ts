// SON-1.6 — o portão que impede o robô de ligar fora de hora.
//
// R3: 9h–20h em dia útil, 9h–13h no sábado, nada no domingo nem em feriado
// nacional. O horário é sempre o de QUEM RECEBE, derivado do DDD.
//
// ---------------------------------------------------------------------------
// A REGRA SAIU DAQUI (30/09/2026, SON-2.2)
//
// Até hoje este módulo continha a implementação da R3 em TypeScript. A prévia
// de exclusões da SON-2.2 precisa contar "fora de janela" como um dos motivos,
// e o card proíbe a tela recalcular portão por conta própria: "vira uma
// simulação que diverge da realidade, e a prévia mentirosa é pior que nenhuma
// prévia". Com a regra só aqui dentro, a única saída seria escrevê-la de novo
// no navegador — dois portões que divergem no dia em que um mudar.
//
// Então a regra foi para o banco (nexilead, migration 0406:
// np_fn_sonar_janela_discagem), que é onde os outros cinco portões já moram, e
// este módulo virou o cliente dela. A tela e o discador leem a MESMA função.
//
// O que se perdeu na mudança, e como foi coberto: os 13 testes de borda que
// rodavam aqui a cada release (`node --test tests/*.test.mjs`) foram portados
// para backend/tests/sql/test_0406_janela_r3.sql, no repo nexilead, e rodam na
// CI contra um Postgres descartável. Uma regra de conformidade não podia trocar
// cobertura automática por ensaio manual.
//
// ---------------------------------------------------------------------------
// O QUE MUDOU NO CUSTO
//
// Antes isto era computação pura, sem banco nem rede, e por isso o orquestrador
// consultava a janela ANTES do opt-out: número fora de hora não chegava a
// custar uma consulta. Agora é um RPC, como o opt-out e o portão de tentativas.
// A ordem no laço foi mantida de propósito: mudá-la mudaria QUAL motivo um
// número recebe quando mais de um portão o barraria, e isso é relatório que
// alguém já lê.

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

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
  /** Data e hora no fuso de quem recebe, para o motivo ser conferível. */
  horaLocal: string;
  /** 0 = domingo … 6 = sábado, no fuso do lead. */
  diaSemana: number;
  feriado: string | null;
};

/**
 * Fail-closed como os outros portões: se o RPC não responder, ou responder algo
 * que não é o veredito esperado, a discagem é bloqueada. Janela indisponível
 * não pode virar "pode ligar" — o risco aqui é ligar fora do horário permitido.
 */
export class JanelaIndisponivel extends Error {}

export async function janelaDeDiscagem(
  sb: RpcClient,
  e164: unknown,
  opcoes: { bloquearFacultativos?: boolean } = {},
): Promise<Veredito> {
  let bruto: Record<string, unknown>;
  try {
    const { data, error } = await sb.rpc("np_fn_sonar_janela_discagem", {
      p_e164: typeof e164 === "string" ? e164 : null,
      p_bloquear_facultativos: opcoes.bloquearFacultativos === true,
    });
    if (error || !data || typeof data !== "object") throw new Error("Resposta invalida");
    bruto = data as Record<string, unknown>;
    if (typeof bruto.pode !== "boolean" || typeof bruto.codigo !== "string") {
      throw new Error("Resposta sem veredito");
    }
  } catch {
    throw new JanelaIndisponivel(
      "Portao de janela de discagem indisponivel ou resposta invalida; discagem bloqueada",
    );
  }

  return {
    pode: bruto.pode as boolean,
    motivo: String(bruto.motivo ?? ""),
    codigo: bruto.codigo as Veredito["codigo"],
    offsetHoras: Number(bruto.offset_horas ?? -3),
    ddd: String(bruto.ddd ?? ""),
    horaLocal: String(bruto.hora_local ?? ""),
    diaSemana: Number(bruto.dia_semana ?? -1),
    feriado: bruto.feriado == null ? null : String(bruto.feriado),
  };
}
