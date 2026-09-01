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
// Correlação com o telefone testado é feita por ia_conversation_id — colunas
// próprias do LDR Automático em np_lead_telefones (migration 0320), gravadas
// pelo orquestrador (a construir) a partir do conversation_id que o
// POST /v1/convai/sip-trunk/outbound-call devolve ao disparar a ligação. Sem
// o orquestrador rodando ainda, este webhook não vai achar telefone pra
// nenhum conversation_id — isso é esperado até aquela peça existir.

import { createClient } from "npm:@supabase/supabase-js@2";

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

  if (!timestamp || !assinaturaRecebida) {
    return { ok: false, motivo: "header_malformado" };
  }

  const agora = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);

  if (!Number.isFinite(ts) || Math.abs(agora - ts) > TOLERANCIA_TIMESTAMP_SEGUNDOS) {
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
    // ==========================================================
    // ACHAR O TELEFONE TESTADO
    // ==========================================================

    const { data: telefone, error: buscaError } = await sb
      .from("np_lead_telefones")
      .select("id, lead_id")
      .eq("ia_conversation_id", conversationId)
      .maybeSingle();

    if (buscaError) {
      throw new Error(
        `Erro buscando telefone por conversation_id: ${buscaError.message}`,
      );
    }

    if (!telefone) {
      // Não é erro — pode ser um teste feito fora do fluxo, ou o
      // orquestrador ainda não gravou o conversation_id nesta chamada.
      console.warn(
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

    // ==========================================================
    // GRAVAR O VEREDITO
    // ==========================================================

    const { error: updateError } = await sb
      .from("np_lead_telefones")
      .update({
        ia_resultado: resultado,
        ia_testado_em: new Date().toISOString(),
      })
      .eq("id", telefone.id);

    if (updateError) {
      throw new Error(
        `Erro gravando veredito do telefone ${telefone.id}: ${updateError.message}`,
      );
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

    console.log("[WEBHOOK] OK", {
      conversationId,
      telefoneId: telefone.id,
      leadId: telefone.lead_id,
      resultado,
      tagAplicada,
    });

    return respostaJson({
      ok: true,
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
