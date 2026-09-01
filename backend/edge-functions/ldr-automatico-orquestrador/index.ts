// LDR Automático — orquestrador: dispara as ligações do robô ElevenLabs pra
// uma lista de telefones ESCOLHIDA A DEDO (botão manual no dashboard, não
// um pool automático — decisão do Igor em 01/09/2026, escopo do piloto: 4
// leads, ~20 números).
//
// Entrada:  POST { telefone_ids: string[] }  — ids de np_lead_telefones
// Saída:    { ok, processados, ligados: [...], pulados: [...], falhas: [...] }
//
// Pra cada telefone: busca o lead (nome pro dynamic_variables.empresa),
// dispara POST /v1/convai/sip-trunk/outbound-call e grava o conversation_id
// devolvido em np_lead_telefones.ia_conversation_id — é esse campo que o
// ldr-automatico-webhook usa depois pra saber qual telefone recebeu qual
// veredito (ver aquele README em backend/edge-functions/).
//
// Shape do body EXATO conforme passado pelo Pedro em 01/09/2026 (agent_id e
// agent_phone_number_id fixos da conta Nexi no ElevenLabs; to_number sempre
// com +55, igual já vem gravado em np_lead_telefones.e164; dynamic_variables
// só com "empresa" por enquanto):
//   {
//     "agent_id": "...",
//     "agent_phone_number_id": "...",
//     "to_number": "+55...",
//     "conversation_initiation_client_data": { "dynamic_variables": { "empresa": "..." } }
//   }
//
// Resposta real da API (conferida na doc pública em 01/09/2026):
//   { success: boolean, message: string, conversation_id: string|null, sip_call_id: string|null }

import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================
// CONFIGURAÇÃO / SECRETS
// ============================================================

function envObrigatoria(nome: string): string {
  const valor = Deno.env.get(nome);

  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }

  return valor;
}

const SUPABASE_URL = envObrigatoria("SUPABASE_URL");
const SERVICE_ROLE = envObrigatoria("SUPABASE_SERVICE_ROLE_KEY");

// A API key do ElevenLabs — secret do Supabase, nunca em arquivo/commit.
const ELEVENLABS_API_KEY = envObrigatoria("ELEVENLABS_API_KEY");

// Fixos da conta Nexi no ElevenLabs (não são segredo, mas ficam como env var
// pra poder trocar sem precisar de novo deploy).
const ELEVENLABS_AGENT_ID = envObrigatoria("ELEVENLABS_AGENT_ID");
const ELEVENLABS_AGENT_PHONE_NUMBER_ID = envObrigatoria(
  "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
);

const ELEVENLABS_OUTBOUND_CALL_URL =
  "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call";

// Espaço entre uma ligação e outra — o tronco 3CX/ElevenLabs não aguenta
// disparo em rajada. Ajustável, sem dado real de limite ainda (piloto vai
// confirmar).
const PAUSA_ENTRE_LIGACOES_MS = 4000;

// Trava de segurança pro piloto — nada de disparar um lote gigante sem
// querer. Escopo combinado é ~20 números.
const MAX_TELEFONES_POR_LOTE = 50;

// ============================================================
// CORS (chamado direto do dashboard, no browser)
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function respostaJson(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// ORQUESTRADOR
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return respostaJson({ ok: false, erro: "method_not_allowed" }, 405);
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return respostaJson({ ok: false, erro: "invalid_json" }, 400);
  }

  const telefoneIds = body?.telefone_ids;

  if (
    !Array.isArray(telefoneIds) ||
    telefoneIds.length === 0 ||
    !telefoneIds.every((id) => typeof id === "string")
  ) {
    return respostaJson(
      { ok: false, erro: "telefone_ids precisa ser um array não vazio de strings" },
      400,
    );
  }

  if (telefoneIds.length > MAX_TELEFONES_POR_LOTE) {
    return respostaJson(
      {
        ok: false,
        erro: `lote grande demais (${telefoneIds.length}) — máximo ${MAX_TELEFONES_POR_LOTE} por disparo`,
      },
      400,
    );
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const ligados: Record<string, unknown>[] = [];
  const pulados: Record<string, unknown>[] = [];
  const falhas: Record<string, unknown>[] = [];

  for (let i = 0; i < telefoneIds.length; i++) {
    const telefoneId = telefoneIds[i];

    try {
      const { data: telefone, error: buscaError } = await sb
        .from("np_lead_telefones")
        .select("id, e164, ia_conversation_id, lead_id, np_leads(nome_exibicao, razao_social)")
        .eq("id", telefoneId)
        .maybeSingle();

      if (buscaError) {
        throw new Error(`Erro buscando telefone: ${buscaError.message}`);
      }

      if (!telefone) {
        pulados.push({ telefoneId, motivo: "telefone_nao_encontrado" });
        continue;
      }

      if (telefone.ia_conversation_id) {
        // Já foi discado antes — nunca liga de novo pro mesmo número sem
        // querer (evita incomodar a mesma empresa duas vezes por um clique
        // duplicado no botão).
        pulados.push({
          telefoneId,
          motivo: "ja_tinha_conversation_id",
          conversationIdExistente: telefone.ia_conversation_id,
        });
        continue;
      }

      // deno-lint-ignore no-explicit-any
      const lead = telefone.np_leads as any;
      const empresa = lead?.nome_exibicao || lead?.razao_social || "";

      const payload = {
        agent_id: ELEVENLABS_AGENT_ID,
        agent_phone_number_id: ELEVENLABS_AGENT_PHONE_NUMBER_ID,
        to_number: telefone.e164,
        conversation_initiation_client_data: {
          dynamic_variables: { empresa },
        },
      };

      const res = await fetch(ELEVENLABS_OUTBOUND_CALL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      const resBody = await res.json().catch(() => null);

      if (!res.ok || !resBody?.success || !resBody?.conversation_id) {
        falhas.push({
          telefoneId,
          e164: telefone.e164,
          status: res.status,
          resposta: resBody,
        });
        continue;
      }

      const { error: updateError } = await sb
        .from("np_lead_telefones")
        .update({ ia_conversation_id: resBody.conversation_id })
        .eq("id", telefoneId);

      if (updateError) {
        // A ligação JÁ FOI FEITA — não dá pra desfazer. Registra a falha de
        // gravação separado, com o conversation_id, pra corrigir manualmente
        // depois (senão o webhook nunca vai achar esse telefone).
        falhas.push({
          telefoneId,
          e164: telefone.e164,
          motivo: "ligacao_feita_mas_erro_ao_gravar_conversation_id",
          conversationId: resBody.conversation_id,
          erro: updateError.message,
        });
        continue;
      }

      ligados.push({
        telefoneId,
        e164: telefone.e164,
        empresa,
        conversationId: resBody.conversation_id,
      });

      console.log("[ORQUESTRADOR] Ligação disparada", {
        telefoneId,
        conversationId: resBody.conversation_id,
      });
    } catch (erro) {
      falhas.push({
        telefoneId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }

    if (i < telefoneIds.length - 1) {
      await pausa(PAUSA_ENTRE_LIGACOES_MS);
    }
  }

  return respostaJson({
    ok: true,
    processados: telefoneIds.length,
    ligados,
    pulados,
    falhas,
  });
});
