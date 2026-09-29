// SON-2.11 — a conversa do LDR, guardada em casa.
//
// Três lugares precisam concordar no formato do transcript: o webhook (chamada
// nova), o backfill (as 431 antigas) e a edge `ldr-automatico-conversa`, que é
// quem a tela já usa hoje. Se cada um normalizasse por conta, a mesma conversa
// apareceria diferente conforme a porta de entrada — e a comparação entre o que
// veio pelo webhook e o que veio pelo backfill deixaria de valer.
//
// Este módulo é puro, de propósito: sem banco, sem rede, sem relógio implícito.
// Quem grava é `montarLinha` + o cliente de quem chama.

import { extrairQualidade } from "./ldr-qualidade.mjs";
import { extrairPorteiro } from "./ldr-porteiro.mjs";

export type Turno = { role: "robo" | "empresa"; mensagem: string; seg: number | null };

export type LinhaConversa = {
  conversation_id: string;
  telefone_id: string | null;
  lead_id: string | null;
  agent_id: string | null;
  status: string | null;
  iniciada_em: string | null;
  duracao_seg: number | null;
  resultado: string | null;
  custo_valor: number | null;
  custo_unidade: string | null;
  transcript: Turno[];
  metadados: Record<string, unknown>;
  origem: "webhook" | "backfill";
};

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

/**
 * Mesma conversão que a edge `ldr-automatico-conversa` já fazia: `agent` vira
 * `robo` e qualquer outro papel vira `empresa`. Mantida idêntica para que a
 * tela não precise saber de onde a conversa veio.
 *
 * Nunca lança: transcript ausente ou malformado vira lista vazia. Um payload
 * estranho não pode derrubar o webhook e, com ele, o veredito e o opt-out.
 */
export function normalizarTranscript(bruto: unknown): Turno[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((t) => {
    const turno = objeto(t);
    const seg = turno.time_in_call_secs;
    return {
      role: turno.role === "agent" ? "robo" as const : "empresa" as const,
      mensagem: typeof turno.message === "string" ? turno.message : "",
      seg: typeof seg === "number" && Number.isFinite(seg) ? seg : null,
    };
  });
}

/** `start_time_unix_secs` (segundos) vira ISO. Fora de faixa vira null. */
export function inicioEmIso(metadata: Record<string, unknown>): string | null {
  const s = metadata.start_time_unix_secs;
  if (typeof s !== "number" || !Number.isFinite(s) || s <= 0) return null;
  const d = new Date(s * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function duracaoValida(valor: unknown): number | null {
  // A mesma faixa do CHECK da 0392: negativo ou mais de 24h não é duração, é
  // payload estragado — e um insert recusado pelo banco perderia a conversa.
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor < 86400
    ? Math.trunc(valor)
    : null;
}

/**
 * Monta a linha de `np_ldr_conversas` a partir do bloco `data` do evento
 * `post_call_transcription` — ou do corpo devolvido por
 * GET /v1/convai/conversations/{id}, que tem o mesmo formato nos campos que
 * interessam. É o que permite webhook e backfill compartilharem esta função.
 */
export function montarLinha(
  data: Record<string, unknown>,
  extras: {
    conversationId: string;
    origem: "webhook" | "backfill";
    telefoneId?: string | null;
    leadId?: string | null;
    resultado?: string | null;
    custoValor?: number | null;
    custoUnidade?: string | null;
    promptHash?: string | null;
  },
): LinhaConversa {
  const metadata = objeto(data.metadata);
  const transcript = normalizarTranscript(data.transcript);

  return {
    conversation_id: extras.conversationId,
    telefone_id: extras.telefoneId ?? null,
    lead_id: extras.leadId ?? null,
    agent_id: texto(data.agent_id),
    status: texto(data.status),
    iniciada_em: inicioEmIso(metadata),
    duracao_seg: duracaoValida(metadata.call_duration_secs),
    resultado: extras.resultado ?? null,
    custo_valor: typeof extras.custoValor === "number" ? extras.custoValor : null,
    custo_unidade: extras.custoUnidade ?? null,
    transcript,
    // O bloco de metadados inteiro, menos o transcript, que já tem coluna
    // própria. Guardar isto evita ter de voltar na ElevenLabs por um campo que
    // já esteve em mãos — versão de prompt e de voz (SON-2.10) moram aqui.
    metadados: {
      metadata,
      analysis: objeto(data.analysis),
      conversation_initiation_client_data: objeto(data.conversation_initiation_client_data),
      // The normalized transcript deliberately retains its existing contract.
      // SON-6.8 telemetry keeps timing/interruptions before normalization loses them.
      qualidade: extrairQualidade(data, { promptHash: extras.promptHash }),
      porteiro: extrairPorteiro(data, extras.resultado),
    },
    origem: extras.origem,
  };
}

/** Cliente mínimo que este módulo precisa — mantém a função testável sem rede. */
type ClienteSb = {
  from: (tabela: string) => {
    upsert: (linha: Record<string, unknown>, opts: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * Grava a conversa, de forma idempotente por `conversation_id`.
 *
 * A regra que não é óbvia: **reentrega com transcript vazio não pode apagar um
 * transcript bom que já está gravado.** A ElevenLabs reentrega o mesmo evento
 * quando a resposta não é 2xx, e nem toda reentrega traz o payload completo.
 * Um upsert cego transformaria uma reentrega tardia em perda de dado — que é
 * exatamente o que esta task existe para impedir.
 *
 * Por isso: com turnos, substitui; sem turnos, só cria se ainda não existir.
 */
export async function gravarConversa(
  sb: ClienteSb,
  linha: LinhaConversa,
): Promise<{ ok: boolean; motivo: string | null }> {
  const temConteudo = linha.transcript.length > 0;
  const { error } = await sb.from("np_ldr_conversas").upsert(
    { ...linha, atualizada_em: new Date().toISOString() },
    { onConflict: "conversation_id", ignoreDuplicates: !temConteudo },
  );
  return error ? { ok: false, motivo: error.message } : { ok: true, motivo: null };
}
