// SON-2.8. Sem numero de destino, transcricao ou segredo no registro de reputacao.
// Schema oficial: https://elevenlabs.io/docs/api-reference/conversations/get
export class ReputacaoBloqueada extends Error {}

export function normalizarOrigem(value: unknown): string {
  const number = typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error("numero de origem ausente ou invalido");
  return number;
}

export async function buscarOrigem(apiKey: string, phoneId: string, base = "https://api.elevenlabs.io") {
  const response = await fetch(`${base}/v1/convai/phone-numbers/${encodeURIComponent(phoneId)}`, {
    headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`origem_indisponivel: HTTP ${response.status}`);
  const body = await response.json();
  if (body.phone_number_id !== phoneId) throw new Error("identidade da origem divergente");
  return normalizarOrigem(body.phone_number);
}

// A interface minima permite testar o portao sem rede ou chave de producao.
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export async function conferirReputacao(sb: Client, origem: string) {
  const { data, error } = await sb.rpc("np_fn_sonar_reputacao_portao", { p_origem: origem });
  if (error || !data || typeof data.permitido !== "boolean") {
    throw new ReputacaoBloqueada("Monitor de reputacao indisponivel; nenhuma nova chamada autorizada");
  }
  if (data.permitido !== true) {
    throw new ReputacaoBloqueada(data.motivo_bloqueio || "Origem bloqueada pelo monitor de reputacao");
  }
  return data;
}

export function extrairChamada(data: any) {
  const metadata = data?.metadata;
  const phone = metadata?.phone_call;
  // Web/widget/inbound nao pertencem ao denominador de telefonia de saida.
  if (!phone || phone.direction !== "outbound") return null;
  const origem = normalizarOrigem(phone.agent_number);
  if (typeof data.conversation_id !== "string" || !data.conversation_id.trim() ||
      typeof data.agent_id !== "string" || !data.agent_id.trim()) throw new Error("identidade da chamada ausente");
  const start = metadata.start_time_unix_secs;
  if (typeof start !== "number" || !Number.isFinite(start) || start<=0) throw new Error("inicio da chamada ausente");
  const duration = metadata.call_duration_secs;
  // Ausente/invalido permanece null: nunca converter para zero segundos.
  const seconds = typeof duration === "number" && Number.isFinite(duration) && duration>=0 && duration<86400
    ? duration : null;
  if (data.status && data.status !== "done" && data.status !== "failed") throw new Error("chamada ainda nao finalizada");
  return { p_origem: origem, p_conversation_id: data.conversation_id, p_agent_id: data.agent_id,
    p_inicio: new Date(start*1000).toISOString(), p_duracao: seconds, p_estado: data.status || "done" };
}

export async function registrarReputacao(sb: Client, data: unknown) {
  const record = extrairChamada(data);
  if (!record) return;
  const { error } = await sb.rpc("np_fn_sonar_reputacao_registrar", record);
  if (error) throw new Error("Falha ao persistir reputacao; reentrega do webhook necessaria");
}
