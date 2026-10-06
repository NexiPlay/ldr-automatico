// SON-4.4: teto de vazao diaria (o "degrau"), aplicado no orquestrador.
//
// POR QUE AQUI, SE O TETO JA ESTA EM np_fn_fila_ler
// Porque existem dois caminhos de discagem, e aquele so cobre um. A tela de
// lote (ldr-automatico-lote.js, SON-2.1) chama esta edge DIRETO, sem passar
// pela fila da SON-1.8 — decisao consciente de 30/09, documentada no cabecalho
// daquele arquivo. O orquestrador e o unico ponto por onde os dois passam.
//
// Em 06/10 isso deixou de ser teoria: a migration 0432 subiu o teto as 14:35
// com degrau 0, e as 14:48 sairam sete chamadas pelo caminho direto.
//
// FAIL-CLOSED, como os portoes vizinhos (sonar-portao-tentativas.ts). Se o RPC
// cair, ninguem disca. Teto de gasto que "libera quando o banco esta instavel"
// e o teto errando no unico lado que importa.
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export class DegrauIndisponivel extends Error {}

export type Degrau = { valorDia: number; usadoHoje: number; resta: number };

export async function degrauAtual(sb: RpcClient): Promise<Degrau> {
  try {
    const { data, error } = await sb.rpc("np_fn_sonar_degrau_atual", {});
    // A funcao RETURNS TABLE com uma linha: o PostgREST devolve array.
    const linha = Array.isArray(data) ? data[0] : data;
    if (error || !linha || typeof linha !== "object") throw new Error("Resposta invalida");
    const d = linha as Record<string, unknown>;
    const resta = Number(d.resta);
    if (!Number.isFinite(resta)) throw new Error("resta ausente");
    return {
      valorDia: Number(d.valor_dia) || 0,
      usadoHoje: Number(d.usado_hoje) || 0,
      resta,
    };
  } catch {
    throw new DegrauIndisponivel(
      "Teto de vazao diaria (degrau) indisponivel ou resposta invalida; discagem bloqueada",
    );
  }
}
