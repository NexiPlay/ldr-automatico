// SON-1.7: portao unico das 48h + teto de tentativas, por CNPJ raiz
// (robo+humano somados no R1/teto absoluto). np_fn_sonar_pode_discar e
// fail-closed no lado do banco (CNPJ ilegivel nunca disca); aqui o
// fail-closed cobre o RPC em si (erro de rede/infra tambem bloqueia).
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export class SonarPortaoIndisponivel extends Error {}

export async function podeDiscarSonar(sb: RpcClient, cnpj: unknown, agente: "ldr" | "sdr"): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("np_fn_sonar_pode_discar", {
      p_cnpj: typeof cnpj === "string" && cnpj.trim() ? cnpj : null,
      p_agente: agente,
    });
    if (error || typeof data !== "boolean") throw new Error("Resposta invalida");
    return data;
  } catch {
    throw new SonarPortaoIndisponivel("Portao de 48h/teto de tentativas indisponivel ou resposta invalida; discagem bloqueada");
  }
}
