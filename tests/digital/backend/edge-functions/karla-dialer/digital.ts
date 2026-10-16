/** DIG-3.2: contexto consultado no servidor, com lote, território e certificação.
 * A ausência de fatos bloqueia a chamada; ausência de certificado bloqueia reunião.
 */
export type DigitalVariables = {
  empresa: string; lead_id: string; grupo: "B3" | "optante"; regiao: string;
  data_atual: string; data_yyyymmdd: number; fase_digital: "preparacao" | "estudo" | "operacao";
  rca_certificado: boolean; reuniao_liberada: boolean; agenda_disponivel: boolean;
};
export type DigitalContext = { branch_id: string; dynamic_variables: DigitalVariables };
type ContextRecord = {
  ok?: unknown; lead_id?: unknown; lote_id?: unknown; codigo_ibge?: unknown;
  grupo?: unknown; regiao?: unknown; fonte?: unknown; valido_ate?: unknown;
  rca_certificado?: unknown; certificacao_evento_id?: unknown; reuniao_liberada?: unknown;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import approval from "./digital-approval.json" with { type: "json" };

export const DIGITAL_RELEASE = approval;

// Pin branch and immutable version before each call, including a changed branch tip.
export function conferirVersaoDigital(agent: unknown, branchId = DIGITAL_RELEASE.branch_id): void {
  const value = agent as Record<string, unknown> | null;
  if (!value || branchId !== DIGITAL_RELEASE.branch_id || value.agent_id !== DIGITAL_RELEASE.agent_id ||
      value.branch_id !== DIGITAL_RELEASE.branch_id || value.version_id !== DIGITAL_RELEASE.version_id) {
    throw new Error("Digital agent, branch or version differs from the joint suite");
  }
}

export function dataDigital(now: Date): Pick<DigitalVariables, "data_atual" | "fase_digital"> {
  if (!Number.isFinite(now.getTime())) throw new Error("Data do servidor inválida");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const date = ["year", "month", "day"].map(k => parts.find(p => p.type === k)!.value).join("-");
  return { data_atual: date, fase_digital: date < "2026-12-07" ? "preparacao" : date < "2027-01-04" ? "estudo" : "operacao" };
}

export function prepararContextoDigital(input: {
  leadId: string | null; empresa: string; enabled: string | undefined;
  contexto: unknown; now?: Date;
}): DigitalContext {
  if (input.enabled !== "true") throw new Error("Digital ainda não liberado para discagem");
  if (!input.leadId || !UUID.test(input.leadId)) throw new Error("Digital exige lead_id válido resolvido no banco");
  const context = input.contexto as ContextRecord | null;
  if (!context || context.ok !== true || context.lead_id !== input.leadId ||
      typeof context.lote_id !== "string" || !UUID.test(context.lote_id) ||
      typeof context.codigo_ibge !== "string" || !/^\d{7}$/.test(context.codigo_ibge)) {
    throw new Error("Contexto Digital sem vínculo válido com lead, lote e município");
  }
  if (context.grupo !== "B3" && context.grupo !== "optante") throw new Error("Grupo Digital não confirmado no servidor");
  if (typeof context.regiao !== "string" || !/^[A-Z]{2}-R\d{1,2}$/.test(context.regiao)) {
    throw new Error("Região Digital não confirmada no servidor");
  }
  if (typeof context.fonte !== "string" || !context.fonte.trim()) throw new Error("Contexto Digital sem fonte de validação");
  const now = input.now ?? new Date();
  const expires = typeof context.valido_ate === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(context.valido_ate)
    ? Date.parse(context.valido_ate) : NaN;
  if (!Number.isFinite(expires) || expires <= now.getTime() || expires > now.getTime() + 48 * 60 * 60 * 1000) {
    throw new Error("Contexto Digital vencido ou sem validade de até 48 horas");
  }
  const date = dataDigital(now);
  const certificado = context.rca_certificado === true && typeof context.certificacao_evento_id === "string" && UUID.test(context.certificacao_evento_id);
  return { branch_id: DIGITAL_RELEASE.branch_id, dynamic_variables: {
    empresa: input.empresa, lead_id: input.leadId, grupo: context.grupo, regiao: context.regiao,
    ...date, data_yyyymmdd: Number(date.data_atual.replaceAll("-", "")),
    rca_certificado: certificado,
    reuniao_liberada: certificado && context.reuniao_liberada === true && date.fase_digital !== "preparacao",
    // Consulta e reserva de agenda pertencem a DIG-3.5/DIG-4.2.
    agenda_disponivel: false,
  } };
}

export function conferirPortoesDigital(janela: unknown, degraus: unknown): void {
  if (!janela || typeof janela !== "object" || !("pode" in janela) || janela.pode !== true) {
    throw new Error("Digital bloqueado pela janela de discagem");
  }
  const row = Array.isArray(degraus) && degraus.length === 1 ? degraus[0] : null;
  if (!row || !Number.isFinite(Number(row.valor_dia)) || Number(row.valor_dia) <= 0 ||
      !Number.isFinite(Number(row.resta)) || Number(row.resta) <= 0) {
    throw new Error("Digital bloqueado pelo degrau de discagem");
  }
}
