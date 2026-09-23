// Shared by the release gate and the dialer. No network fallback and no cached approval.
export const R5 = Object.freeze({
  razao_social: "Tendência Energia",
  finalidade: "confirmar a empresa deste telefone e saber quem cuida de energia",
  assistente_virtual: "assistente virtual",
  gravacao: "Esta ligação está sendo gravada",
});

export const BRIEFING_FIELDS = Object.freeze([
  "razao_social", "nome_fantasia", "cnae_principal", "situacao_cadastral",
  "logradouro", "municipio", "uf", "places_nome", "places_endereco",
]);

export function normalize(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

export function assertR5(text, source = "prompt") {
  if (typeof text !== "string" || !text.trim()) throw new Error(`R5: ${source} vazio`);
  const missing = Object.entries(R5).filter(([, marker]) => !normalize(text).includes(normalize(marker)))
    .map(([key]) => key);
  if (missing.length) throw new Error(`R5: ${source} sem ${missing.join(", ")}`);
}

// CRLF and a trailing newline are transport differences, not prompt changes.
export function canonicalText(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

export async function promptDigest(prompt, firstMessage) {
  return await sha256(JSON.stringify([canonicalText(prompt), canonicalText(firstMessage)]));
}

export async function assertApprovedAgent(agent, approval) {
  const config = agent?.conversation_config?.agent;
  const prompt = config?.prompt?.prompt;
  const firstMessage = config?.first_message;
  assertR5(prompt);
  assertR5(firstMessage, "first_message");
  if (agent.agent_id !== approval.agent_id) throw new Error("Agente diferente do LDR aprovado");
  if (await promptDigest(prompt, firstMessage) !== approval.prompt_sha256) {
    throw new Error("Prompt remoto diverge da versão Bruno revisada; discagem/deploy bloqueado");
  }
  return agent;
}

export function elevenlabsBase(value = "https://api.elevenlabs.io") {
  const allowed = ["https://api.elevenlabs.io", "https://api.us.elevenlabs.io", "https://api.eu.residency.elevenlabs.io", "https://api.in.residency.elevenlabs.io"];
  if (!allowed.includes(value)) throw new Error("Host ElevenLabs não permitido");
  return value;
}

export async function fetchApprovedAgent({ apiKey, agentId, approval, baseUrl, fetchImpl = fetch }) {
  if (!apiKey || !agentId) throw new Error("Credenciais ElevenLabs ausentes; verificação obrigatória");
  const response = await fetchImpl(`${elevenlabsBase(baseUrl)}/v1/convai/agents/${encodeURIComponent(agentId)}`, {
    headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Não foi possível validar agente ElevenLabs (HTTP ${response.status})`);
  return await assertApprovedAgent(await response.json(), approval);
}

export class PromptGateError extends Error {}

function clean(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) : "";
}

export function buildBriefing(row, fallbackName = "") {
  const data = Object.fromEntries(BRIEFING_FIELDS.map((key) => [key, clean(row?.[key])]).filter(([, v]) => v));
  return {
    empresa: data.razao_social || data.nome_fantasia || data.places_nome || clean(fallbackName),
    briefing_lead: JSON.stringify({ disponivel: Object.keys(data).length > 0, empresa: data }),
  };
}

export async function loadBriefing(sb, leadId, fallbackName) {
  const { data, error } = await sb.from("np_lead_enriquecimento")
    .select(BRIEFING_FIELDS.join(","))
    .eq("lead_id", leadId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1).maybeSingle();
  // Missing row is legitimate; a query/schema error must not masquerade as no briefing.
  if (error) throw new Error("Falha ao consultar briefing estruturado; discagem bloqueada");
  return buildBriefing(data, fallbackName);
}
