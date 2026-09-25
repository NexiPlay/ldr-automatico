// SON-1.5: redflag vem da análise pós-chamada; false nunca remove um bloqueio.
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export function extrairRedflag(analysis: unknown): boolean | null {
  const results = (analysis as { data_collection_results?: Record<string, unknown> } | null)?.data_collection_results;
  let value = results?.redflag;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    value = item.value ?? item.valor;
  }
  if (value == null) return null; // chamadas antigas / campo ainda não configurado
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
    return value.trim().toLowerCase() === "true";
  }
  throw new Error("redflag_invalido: esperado boolean true/false; não assumir false");
}

export class OptoutIndisponivel extends Error {}

export async function podeContatar(sb: RpcClient, e164: unknown, cnpj: unknown): Promise<boolean> {
  if (typeof e164 !== "string" || !e164.trim()) throw new OptoutIndisponivel("Telefone ausente; discagem bloqueada");
  try {
    const { data, error } = await sb.rpc("np_fn_pode_contatar", {
      p_e164: e164, p_cnpj: typeof cnpj === "string" && cnpj.trim() ? cnpj : null,
    });
    if (error || typeof data !== "boolean") throw new Error("Resposta inválida");
    return data;
  } catch {
    throw new OptoutIndisponivel("Portão de opt-out indisponível ou resposta inválida; discagem bloqueada");
  }
}

export async function registrarOptout(sb: RpcClient, telefone: {
  e164: string; lead_id: string; cnpj: string | null;
}, conversationId: string, eventTimestamp: unknown) {
  if (typeof eventTimestamp !== "number" || !Number.isFinite(eventTimestamp) || eventTimestamp <= 0 ||
      !Number.isFinite(new Date(eventTimestamp * 1000).getTime())) {
    throw new Error("event_timestamp ausente/inválido para registrar redflag; reentrega necessária");
  }
  const comum = {
    p_fonte: "verbal_chamada", p_pedido_em: new Date(eventTimestamp * 1000).toISOString(),
    p_lead_id: telefone.lead_id,
    p_observacao: `SON-1.5: ElevenLabs redflag=true; conversation_id=${conversationId}; análise pós-chamada`,
  };
  // SON-1.4 recebe exatamente UMA chave por chamada. Ambas são obrigatórias
  // quando há CNPJ real. Falha parcial devolve 5xx; a reentrega reaplica o upsert.
  for (const chave of [{ p_e164: telefone.e164 }, ...(telefone.cnpj ? [{ p_cnpj: telefone.cnpj }] : [])]) {
    const { data, error } = await sb.rpc("np_fn_opt_out_registrar", { ...comum, ...chave });
    if (error || typeof data !== "string" || !data) throw new Error("Falha persistindo opt-out; reentrega necessária");
  }
}
