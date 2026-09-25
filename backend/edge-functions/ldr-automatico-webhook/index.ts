// LDR Automático — recebe o webhook de pós-chamada do ElevenLabs (evento
// "post_call_transcription") e grava o veredito no telefone testado.
//
// URL a passar pro Pedro configurar no painel do ElevenLabs (Webhooks do
// agente), depois de fazer o deploy:
//   https://wbagoinuxgvntvbbnmab.supabase.co/functions/v1/ldr-automatico-webhook
//
// O ElevenLabs assina cada entrega com HMAC-SHA256 (header
// "ElevenLabs-Signature: t=<timestamp>,v0=<hex>", string assinada é
// "<timestamp>.<corpo_cru>", segredo usado como texto puro — sem SDK
// disponível pra Deno, então a verificação abaixo é manual, conferida contra
// a doc pública em 01/09/2026). O segredo de assinatura é gerado pelo
// ElevenLabs quando o webhook é cadastrado — NÃO é a API key, e não deve ser
// commitado em lugar nenhum: só como secret do Supabase
// (ELEVENLABS_WEBHOOK_SECRET).
//
// Correlação pelo ia_conversation_id gravado pelo orquestrador.
// SONAR: grava custo pós-chamada nas colunas da migração 01-sonar-carimbo.sql.
// Custo principal = metadata.cost_fiat, USD (total reportado pela ElevenLabs).
// Referência: https://api.elevenlabs.io/openapi.json
// Não inclui automaticamente despesas de telefonia cobradas pelo tronco externo.

import { createClient } from "npm:@supabase/supabase-js@2";
import { registrarReputacao } from "../_shared/sonar-reputacao.ts";

// ============================================================
// CONFIGURAÇÃO / SECRETS
// ============================================================

function envObrigatoria(nome: string): string {
  const valor = Deno.env.get(nome);

  if (!valor) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${nome}`,
    );
  }

  return valor;
}

const SUPABASE_URL = envObrigatoria("SUPABASE_URL");
const SERVICE_ROLE = envObrigatoria("SUPABASE_SERVICE_ROLE_KEY");

// Secret criado especificamente pra este webhook — o de assinatura que o
// ElevenLabs gera ao cadastrar o endpoint (painel do agente > Webhooks),
// não a API key usada pra disparar chamadas.
const WEBHOOK_SECRET = envObrigatoria("ELEVENLABS_WEBHOOK_SECRET");

// Tolerância de 30 min pro timestamp da assinatura (mesma janela que o
// ElevenLabs usa no SDK oficial) — mitiga replay de um payload capturado.
const TOLERANCIA_TIMESTAMP_SEGUNDOS = 1800;

// Veredito que, quando confirmado, libera o lead pro pool do LDR Automático.
const RESULTADOS_VALIDOS = [
  "confirmado",
  "nao_confirmado",
  "inconclusivo",
  "sem_atendimento",
] as const;

type ResultadoIa = typeof RESULTADOS_VALIDOS[number];

const TAG_VALIDADO_LDR_IA = "qualificacao:validado-ldr-ia";

// ============================================================
// HELPERS
// ============================================================

function respostaJson(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hexParaBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  return bytes;
}

function comparacaoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

async function hmacSha256Hex(
  segredo: string,
  mensagem: string,
): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const assinatura = await crypto.subtle.sign(
    "HMAC",
    chave,
    new TextEncoder().encode(mensagem),
  );

  return Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================
// VERIFICAÇÃO DA ASSINATURA
// ============================================================

async function assinaturaValida(
  header: string | null,
  corpoCru: string,
): Promise<{ ok: boolean; motivo?: string }> {
  if (!header) {
    return { ok: false, motivo: "header_ausente" };
  }

  const partes = Object.fromEntries(
    header
      .split(",")
      .map((par) => par.trim().split("=") as [string, string]),
  );

  const timestamp = partes["t"];
  const assinaturaRecebida = partes["v0"];

  if (!timestamp || !/^\d+$/.test(timestamp) ||
    !assinaturaRecebida || !/^[0-9a-fA-F]{64}$/.test(assinaturaRecebida)) {
    return { ok: false, motivo: "header_malformado" };
  }

  const agora = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);

  if (!Number.isSafeInteger(ts) || Math.abs(agora - ts) > TOLERANCIA_TIMESTAMP_SEGUNDOS) {
    return { ok: false, motivo: "timestamp_fora_da_janela" };
  }

  const esperada = await hmacSha256Hex(
    WEBHOOK_SECRET,
    `${timestamp}.${corpoCru}`,
  );

  const bate = comparacaoConstante(
    hexParaBytes(esperada),
    hexParaBytes(assinaturaRecebida),
  );

  return bate ? { ok: true } : { ok: false, motivo: "assinatura_nao_bate" };
}

// ============================================================
// EXTRAÇÃO DO RESULTADO
// ============================================================

// O campo de "data collection" do ElevenLabs pode vir como string direta ou
// como objeto { value, rationale } — depende da versão/config do agente.
// Normalizamos os dois formatos e validamos contra o enum real da migration
// 0320 (minúsculo, snake_case).
// deno-lint-ignore no-explicit-any
function extrairResultado(analysis: any): ResultadoIa | null {
  const bruto = analysis?.data_collection_results?.resultado_validacao;

  const valor =
    typeof bruto === "string"
      ? bruto
      : (bruto?.value ?? bruto?.valor ?? null);

  if (typeof valor !== "string") {
    return null;
  }

  const normalizado = valor.trim().toLowerCase();

  return (RESULTADOS_VALIDOS as readonly string[]).includes(normalizado)
    ? (normalizado as ResultadoIa)
    : null;
}

// ============================================================
// SONAR — custo da conversa, separado de créditos e de telefonia externa
// ============================================================

function objeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}

function valorMonetarioValido(valor: unknown): valor is number {
  // Zero explícito é válido. NULL, string vazia, boolean e número negativo não.
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
}

function metadadosCobranca(data: Record<string, unknown>) {
  const metadata = objeto(data.metadata);
  const charging = objeto(metadata.charging);
  const selecionados: Record<string, unknown> = {};
  for (const nome of [
    "llm_price", "llm_charge", "call_charge", "platform_price",
    "platform_charge", "free_minutes_consumed", "free_llm_dollars_consumed",
  ]) {
    if (valorMonetarioValido(charging[nome])) selecionados[nome] = charging[nome];
  }
  for (const nome of ["dev_discount", "is_burst"]) {
    if (typeof charging[nome] === "boolean") selecionados[nome] = charging[nome];
  }
  if (typeof charging.tier === "string") selecionados.tier = charging.tier;

  return {
    // Os nomes e valores brutos são preservados para auditoria. Não somar
    // metadata.cost ou charging.* ao cost_fiat: são representações/componentes.
    cost_fiat: valorMonetarioValido(metadata.cost_fiat) ? metadata.cost_fiat : null,
    cost: valorMonetarioValido(metadata.cost) ? metadata.cost : null,
    charging: selecionados,
    call_duration_secs: valorMonetarioValido(metadata.call_duration_secs)
      ? metadata.call_duration_secs : null,
    start_time_unix_secs: valorMonetarioValido(metadata.start_time_unix_secs)
      ? metadata.start_time_unix_secs : null,
  };
}

async function resolverCusto(
  data: Record<string, unknown>,
  conversationId: string,
  agentIdEsperado: string | null,
): Promise<{ campos: Record<string, unknown>; pendente: boolean; motivo: string | null }> {
  let origem = "post_call_transcription";
  let consulta = data;
  let motivo: string | null = null;

  if (!valorMonetarioValido(objeto(data.metadata).cost_fiat)) {
    // Mesmo secret do orquestrador. Só necessário se o evento não trouxer custo.
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      motivo = "api_key_ausente_para_consultar_custo";
    } else {
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
          { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) {
          motivo = `consulta_custo_http_${res.status}`;
        } else {
          const recebida = objeto(await res.json());
          if (recebida.conversation_id !== conversationId ||
            (agentIdEsperado && recebida.agent_id !== agentIdEsperado)) {
            motivo = "consulta_custo_identidade_divergente";
          } else if (recebida.status !== "done" && recebida.status !== "failed") {
            motivo = "conversa_ainda_nao_finalizada";
          } else {
            consulta = recebida;
            origem = "conversation_get";
          }
        }
      } catch {
        motivo = "consulta_custo_rede_timeout_ou_json_invalido";
      }
    }
  }

  const valor = objeto(consulta.metadata).cost_fiat;
  const apurado = motivo === null && valorMonetarioValido(valor);
  if (!apurado && motivo === null) motivo = "cost_fiat_ausente_ou_invalido";
  const detalhes = {
    schema_version: 1,
    status: apurado ? "apurado" : "pendente",
    escopo: "custo_conversa_elevenlabs",
    origem,
    campo_valor: "metadata.cost_fiat",
    conversation_id: conversationId,
    agent_id: typeof consulta.agent_id === "string" ? consulta.agent_id : null,
    // Versão efetiva, quando fornecida. Não substitui o hash lido no disparo.
    version_id: typeof consulta.version_id === "string" ? consulta.version_id
      : typeof data.version_id === "string" ? data.version_id : null,
    metadata: metadadosCobranca(consulta),
    motivo_pendencia: motivo,
  };

  return {
    pendente: !apurado,
    motivo,
    campos: apurado ? {
      ia_custo_valor: valor,
      ia_custo_unidade: "USD",
      ia_custo_detalhes: detalhes,
      ia_custo_atualizado_em: new Date().toISOString(),
    } : {
      // Nunca escrever zero/null por falta de informação, nem apagar valor
      // válido anterior em uma reentrega incompleta do webhook.
      ia_custo_detalhes: detalhes,
    },
  };
}


// ============================================================
// WEBHOOK
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return respostaJson({ ok: false, erro: "method_not_allowed" }, 405);
  }

  // A assinatura é calculada sobre o corpo CRU — tem que ler como texto
  // antes de fazer JSON.parse, senão a verificação nunca bate.
  const corpoCru = await req.text();

  const verificacao = await assinaturaValida(
    req.headers.get("ElevenLabs-Signature"),
    corpoCru,
  );

  if (!verificacao.ok) {
    console.warn("[AUTH] Assinatura recusada", verificacao.motivo);

    return respostaJson(
      { ok: false, erro: "unauthorized", motivo: verificacao.motivo },
      401,
    );
  }

  let body;

  try {
    body = JSON.parse(corpoCru);
  } catch {
    return respostaJson({ ok: false, erro: "invalid_json" }, 400);
  }

  const tipo = String(body?.type ?? "");

  // Eventos que não são de conversação finalizada não são erro — só não
  // interessam a este fluxo. Responder 200 evita retry do ElevenLabs.
  if (tipo !== "post_call_transcription") {
    console.log("[WEBHOOK] Evento ignorado", tipo);

    return respostaJson({ ok: true, tipo, ignorado: true });
  }

  const conversationId = body?.data?.conversation_id;

  if (!conversationId || typeof conversationId !== "string") {
    return respostaJson(
      { ok: false, erro: "conversation_id_ausente" },
      400,
    );
  }

  const resultado = extrairResultado(body?.data?.analysis);

  console.log("[WEBHOOK]", { conversationId, resultado });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // So depois da assinatura. Mesmo sem telefone correlacionado, o trafego
    // outbound afeta a origem. Reentregas sao deduplicadas por conversation_id.
    await registrarReputacao(sb, body.data);
    // ==========================================================
    // ACHAR O TELEFONE TESTADO
    // ==========================================================

    const { data: telefone, error: buscaError } = await sb
      .from("np_lead_telefones")
      .select("id, lead_id, ia_agent_id, ia_custo_valor, ia_custo_unidade, ia_custo_detalhes, ia_custo_atualizado_em")
      .eq("ia_conversation_id", conversationId)
      .maybeSingle();

    if (buscaError) {
      throw new Error(
        `Erro buscando telefone por conversation_id: ${buscaError.message}`,
      );
    }

    if (!telefone) {
      // Não é erro — é o caminho normal pra qualquer ligação feita fora do
      // orquestrador (teste manual direto no ElevenLabs, por exemplo). Fica
      // em console.log (não warn) de propósito, pra não acender como alerta
      // no painel do Supabase por algo que não é um problema.
      console.log(
        "[WEBHOOK] Nenhum telefone com este conversation_id",
        conversationId,
      );

      return respostaJson({
        ok: true,
        conversationId,
        ignorado: true,
        motivo: "telefone_nao_encontrado",
      });
    }

    const dataConversa = objeto(body.data);
    // Conferir o agente também evita atribuir cobrança de outro agente à linha.
    const agentIdEsperado = telefone.ia_agent_id ||
      (typeof dataConversa.agent_id === "string" ? dataConversa.agent_id : null);
    if (telefone.ia_agent_id && dataConversa.agent_id !== telefone.ia_agent_id) {
      throw new Error("agent_id do webhook difere do agente carimbado no telefone");
    }

    // Primeira apuração válida é preservada nas reentregas. Não acumular custo.
    const custoJaGravado = valorMonetarioValido(telefone.ia_custo_valor) &&
      telefone.ia_custo_unidade === "USD";
    const custo = custoJaGravado
      ? { campos: {} as Record<string, unknown>, pendente: false, motivo: null }
      : await resolverCusto(dataConversa, conversationId, agentIdEsperado);

    // ==========================================================
    // GRAVAR O VEREDITO
    // ==========================================================

    let atualizacao = sb
      .from("np_lead_telefones")
      .update({
        ia_resultado: resultado,
        ia_testado_em: new Date().toISOString(),
        ...custo.campos,
      })
      .eq("id", telefone.id)
      .eq("ia_conversation_id", conversationId);

    // Reentregas simultâneas: um payload incompleto não pode sobrescrever os
    // detalhes de um custo que outro request acabou de apurar.
    if (!custoJaGravado && telefone.ia_custo_valor == null) {
      atualizacao = atualizacao.is("ia_custo_valor", null);
    }
    const { data: atualizado, error: updateError } = await atualizacao
      .select("id")
      .maybeSingle();

    if (updateError) {
      throw new Error(
        `Erro gravando veredito do telefone ${telefone.id}: ${updateError.message}`,
      );
    }

    if (!atualizado) {
      throw new Error("Telefone não atualizado: correlação ou custo mudou durante o processamento; reentrega necessária");
    }

    // ==========================================================
    // TAG DE QUALIFICAÇÃO — só quando confirmado
    // ==========================================================

    let tagAplicada = false;

    if (resultado === "confirmado") {
      const { data: tag, error: tagError } = await sb
        .from("np_tags")
        .select("id")
        .eq("slug", TAG_VALIDADO_LDR_IA)
        .maybeSingle();

      if (tagError) {
        throw new Error(`Erro buscando tag de qualificação: ${tagError.message}`);
      }

      if (!tag) {
        // A migration 0321 semeia essa tag — se não existir, algo não foi
        // aplicado ainda. Não derruba o webhook (o veredito já foi salvo),
        // só fica sem marcar o lead como liberado.
        console.error(
          "[WEBHOOK] Tag de qualificação não encontrada — 0321 aplicada?",
          TAG_VALIDADO_LDR_IA,
        );
      } else {
        const { error: upsertError } = await sb
          .from("np_lead_tags")
          .upsert(
            {
              lead_id: telefone.lead_id,
              tag_id: tag.id,
              atribuida_por: "sistema:ldr-automatico",
            },
            { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
          );

        if (upsertError) {
          throw new Error(`Erro aplicando tag no lead: ${upsertError.message}`);
        }

        tagAplicada = true;
      }
    }

    if (custo.pendente) {
      // Veredito/tag já foram tratados. Falha explícita permite reentrega
      // quando retries estão habilitados na ElevenLabs; nunca reportar custo 0.
      console.warn("[WEBHOOK] Custo pendente", { conversationId, motivo: custo.motivo });
      return respostaJson({
        ok: false,
        conversationId,
        telefoneId: telefone.id,
        resultado,
        tagAplicada,
        vereditoGravado: true,
        custoPendente: true,
        motivo: custo.motivo,
      }, 503);
    }

    console.log("[WEBHOOK] OK", {
      conversationId,
      telefoneId: telefone.id,
      leadId: telefone.lead_id,
      resultado,
      tagAplicada,
    });

    return respostaJson({
      ok: true,
      custoGravado: true,
      custoReutilizado: custoJaGravado,
      conversationId,
      telefoneId: telefone.id,
      leadId: telefone.lead_id,
      resultado,
      tagAplicada,
    });
  } catch (erro) {
    console.error("[WEBHOOK] ERRO CRÍTICO", {
      conversationId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });

    return respostaJson(
      {
        ok: false,
        conversationId,
        erro: erro instanceof Error ? erro.message : String(erro),
      },
      500,
    );
  }
});
