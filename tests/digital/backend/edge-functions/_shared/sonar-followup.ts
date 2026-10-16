// SON-3.9: o canal do Sonar nao herda EVOLUTION_INSTANCE da operacao interna.
type LerAmbiente = (nome: string) => string | undefined;

export class CanalFollowupIndisponivel extends Error {
  readonly motivo: string;
  constructor(motivo: string) {
    super(`Canal de follow-up indisponivel: ${motivo}`);
    this.motivo = motivo;
    this.name = "CanalFollowupIndisponivel";
  }
}

function bloquear(motivo: string): never {
  throw new CanalFollowupIndisponivel(motivo);
}

// A Evolution pode representar o mesmo celular BR com ou sem o nono digito.
function identidade(jid: unknown): string {
  if (typeof jid !== "string" || !/^\d{10,15}(?::\d+)?@s\.whatsapp\.net$/.test(jid)) {
    return bloquear("identidade_ausente_ou_invalida");
  }
  const numero = jid.split("@")[0].split(":")[0];
  return numero.startsWith("55") && numero.length === 13 && numero[4] === "9"
    ? numero.slice(0, 4) + numero.slice(5)
    : numero;
}

export async function prepararCanalFollowup(
  lerAmbiente: LerAmbiente,
  fetchImpl: typeof fetch = fetch,
) {
  const instancia = lerAmbiente("SONAR_FOLLOWUP_INSTANCE")?.trim();
  const ownerJid = lerAmbiente("SONAR_FOLLOWUP_OWNER_JID")?.trim();
  const base = lerAmbiente("EVOLUTION_API_URL")?.trim().replace(/\/+$/, "");
  const apikey = lerAmbiente("EVOLUTION_API_KEY");
  if (!instancia || !ownerJid || !base || !apikey) {
    return bloquear("configuracao_ausente");
  }
  if (instancia.toLowerCase() === "karlaandrade") return bloquear("instancia_proibida");
  const esperado = identidade(ownerJid);
  const headers = { apikey, "Content-Type": "application/json" };

  async function consultar(caminho: string): Promise<unknown> {
    try {
      const response = await fetchImpl(`${base}${caminho}`, {
        method: "GET", headers, signal: AbortSignal.timeout(5000), redirect: "error",
      });
      if (!response.ok) return bloquear("consulta_indisponivel");
      return await response.json();
    } catch (error) {
      if (error instanceof CanalFollowupIndisponivel) throw error;
      return bloquear("consulta_indisponivel");
    }
  }

  function obterInstancia(payload: unknown, nome: string): Record<string, unknown> {
    if (!Array.isArray(payload)) return bloquear("resposta_invalida");
    const matches = payload.filter((item) => item && typeof item === "object" && item.name === nome);
    if (matches.length !== 1) return bloquear("resposta_invalida");
    return matches[0];
  }

  const [destinoRaw, karlaRaw, conexaoRaw] = await Promise.all([
    consultar(`/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`),
    consultar("/instance/fetchInstances?instanceName=KarlaAndrade"),
    consultar(`/instance/connectionState/${encodeURIComponent(instancia)}`),
  ]);
  const destino = obterInstancia(destinoRaw, instancia);
  const karla = obterInstancia(karlaRaw, "KarlaAndrade");
  const atual = identidade(destino.ownerJid);
  if (atual === identidade(karla.ownerJid)) return bloquear("remetente_da_karla");
  if (atual !== esperado) return bloquear("remetente_divergente");
  const conexao = conexaoRaw as { instance?: { instanceName?: string; state?: string } } | null;
  if (destino.connectionStatus !== "open" || conexao?.instance?.instanceName !== instancia ||
      conexao.instance.state !== "open") {
    return bloquear("instancia_desconectada");
  }

  // Nenhum payload completo da Evolution e logado: fetchInstances pode conter tokens.
  // O teste com destinatario novo continua necessario: metadados nao provam o remetente real.
  return {
    instancia,
    enviarMidia: (payload: Record<string, unknown>) => fetchImpl(
      `${base}/message/sendMedia/${encodeURIComponent(instancia)}`,
      {
        method: "POST", headers, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000), redirect: "error",
      },
    ),
  };
}
