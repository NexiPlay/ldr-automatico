// LDR Automático — orquestrador: dispara as ligações do robô ElevenLabs pra
// uma lista de telefones ESCOLHIDA A DEDO (botão manual no dashboard, não
// um pool automático — decisão do Igor em 01/09/2026, escopo do piloto: 4
// leads, ~20 números).
//
// Entrada:  POST { telefone_ids: string[] }  — ids de np_lead_telefones
// Saída:    { ok, processados, ligados: [...], pulados: [...], falhas: [...] }
//
// Pra cada telefone: busca o lead e o briefing estruturado permitido,
// valida R5/versão na mesma leitura que produz o carimbo por chamada,
// dispara POST /v1/convai/sip-trunk/outbound-call e grava o conversation_id
// devolvido em np_lead_telefones.ia_conversation_id — é esse campo que o
// ldr-automatico-webhook usa depois pra saber qual telefone recebeu qual
// veredito (ver aquele README em backend/edge-functions/).
//
// Shape do body EXATO conforme passado pelo Pedro em 01/09/2026 (agent_id e
// agent_phone_number_id fixos da conta Nexi no ElevenLabs; to_number sempre
// com +55, igual já vem gravado em np_lead_telefones.e164; dynamic_variables
// com "empresa" e "briefing_lead" desde SON-2.4):
//   {
//     "agent_id": "...",
//     "agent_phone_number_id": "...",
//     "to_number": "+55...",
//     "conversation_initiation_client_data": {
//       "dynamic_variables": { "empresa": "...", "briefing_lead": "{...}" }
//     }
//   }
//
// Resposta real da API (conferida na doc pública em 01/09/2026):
//   { success: boolean, message: string, conversation_id: string|null, sip_call_id: string|null }

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertApprovedAgent, loadBriefing, elevenlabsBase, PromptGateError } from "../_shared/ldr-policy.mjs";
import approval from "../_shared/ldr-approval.json" with { type: "json" };

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

const ELEVENLABS_BASE_URL = elevenlabsBase(Deno.env.get("ELEVENLABS_BASE_URL"));
const ELEVENLABS_OUTBOUND_CALL_URL =
  `${ELEVENLABS_BASE_URL}/v1/convai/sip-trunk/outbound-call`;

// Espaço entre uma ligação e outra — o tronco 3CX/ElevenLabs não aguenta
// disparo em rajada. Ajustável, sem dado real de limite ainda (piloto vai
// confirmar).
const PAUSA_ENTRE_LIGACOES_MS = 4000;

// Trava de segurança pro piloto — nada de disparar um lote gigante sem
// querer. Escopo combinado é ~20 números.
const MAX_TELEFONES_POR_LOTE = 50;

// ============================================================
// SONAR — fotografia do agente imediatamente antes de CADA disparo
// ============================================================

const COLUNAS_CARIMBO = [
  "ia_agent_id", "ia_prompt_hash", "ia_voice_id", "ia_llm_model",
  "ia_tts_model", "ia_config_lida_em", "ia_config_snapshot",
].join(",");

function objetoApi(valor: unknown, campo: string): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new Error(`carimbo_invalido: ${campo} ausente ou inválido`);
  }
  return valor as Record<string, unknown>;
}

function textoApi(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !valor.trim()) {
    throw new Error(`carimbo_invalido: ${campo} ausente ou vazio`);
  }
  // Preserva EXATAMENTE o texto: sem trim, normalização ou substituição de
  // {{empresa}}. A versão identifica o template, não uma empresa específica.
  return valor;
}

async function lerCarimboAgente() {
  const url = `${ELEVENLABS_BASE_URL}/v1/convai/agents/${encodeURIComponent(ELEVENLABS_AGENT_ID)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("carimbo_indisponivel: erro de rede ou timeout ao ler o agente; ligação não disparada");
  }
  if (!res.ok) {
    // Não expor corpo da configuração/chaves em mensagens de erro.
    throw new Error(`carimbo_indisponivel: GET agente HTTP ${res.status}; ligação não disparada`);
  }

  const agente = objetoApi(await res.json(), "agente");
  if (agente.agent_id !== ELEVENLABS_AGENT_ID) {
    throw new Error("carimbo_invalido: agent_id retornado difere do solicitado");
  }
  // A validação e o carimbo usam EXATAMENTE a mesma resposta GET, sem nova leitura.
  // O hash de aprovação (prompt + abertura) não substitui ia_prompt_hash, que
  // continua incluindo voz e preservando os bytes dos textos conforme SON-2.10.
  try {
    await assertApprovedAgent(agente, approval);
  } catch (error) {
    throw new PromptGateError(error instanceof Error ? error.message : "Verificação R5 indisponível");
  }
  const config = objetoApi(agente.conversation_config, "conversation_config");
  const fala = objetoApi(config.agent, "conversation_config.agent");
  const promptConfig = objetoApi(fala.prompt, "conversation_config.agent.prompt");
  const tts = objetoApi(config.tts, "conversation_config.tts");
  const prompt = textoApi(promptConfig.prompt, "agent.prompt.prompt");
  const voiceId = textoApi(tts.voice_id, "tts.voice_id");
  const llmModel = textoApi(promptConfig.llm, "agent.prompt.llm");
  const ttsModel = textoApi(tts.model_id, "tts.model_id");
  const firstMessage = fala.first_message ?? null;
  if (firstMessage !== null && typeof firstMessage !== "string") {
    throw new Error("carimbo_invalido: agent.first_message inválido");
  }

  const lidaEm = new Date().toISOString();
  // Ordem fixa das chaves; UTF-8; SHA-256 hexadecimal minúsculo.
  // A saudação também integra a versão de fala. Modelos ficam em colunas
  // próprias: mudar só o LLM/TTS não muda este hash de prompt + voz.
  const entradaHash = {
    schema_version: 1,
    prompt,
    first_message: firstMessage,
    voice_id: voiceId,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(JSON.stringify(entradaHash)),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return {
    ia_agent_id: ELEVENLABS_AGENT_ID,
    ia_prompt_hash: hash,
    ia_voice_id: voiceId,
    ia_llm_model: llmModel,
    ia_tts_model: ttsModel,
    ia_config_lida_em: lidaEm,
    // Lista explícita: NÃO salvar a resposta inteira (pode conter secrets,
    // ferramentas, cabeçalhos ou URLs de integração).
    ia_config_snapshot: {
      ...entradaHash,
      hash_algorithm: "sha256",
      llm_model: llmModel,
      tts_model: ttsModel,
      language: typeof fala.language === "string" ? fala.language : null,
      source: "elevenlabs_agent_get_pre_dispatch",
    },
  };
}


// ============================================================
// NOME DA EMPRESA — normalização pra fala (pedido do Pedro em 08/09/2026:
// áudio "estranho" numa ligação de teste)
// ============================================================

// nome_exibicao/razao_social vêm da Receita Federal em CAIXA ALTA e sem
// acento (ex.: "COMERCIO DE PECAS ELETRICAS LTDA") — o ElevenLabs fala isso
// literalmente, sem entonação de nome próprio, daí o áudio estranho que o
// Pedro ouviu. Não dá pra recuperar acento de forma genérica (é ambíguo:
// "SAO" pode ser "São" ou nome próprio sem crase), então cobre só o
// vocabulário comum de razão social — o que já resolve a maioria dos casos
// reais. Só mexe em texto TODO em caixa alta (nome digitado à mão no popup
// de disparo, já em maiúsculas/minúsculas normais, passa direto).
const DICIONARIO_ACENTOS: Record<string, string> = {
  ACESSORIOS: "Acessórios", AGROPECUARIA: "Agropecuária", AGRICOLA: "Agrícola",
  ALIMENTICIA: "Alimentícia", ALIMENTICIOS: "Alimentícios",
  AUTOMOVEIS: "Automóveis", CERAMICA: "Cerâmica", CIRURGICA: "Cirúrgica",
  CLINICA: "Clínica", COMERCIO: "Comércio", CONFECCOES: "Confecções",
  CONSTRUCAO: "Construção", CONSTRUCOES: "Construções",
  COSMETICOS: "Cosméticos", DISTRIBUICAO: "Distribuição",
  DOMESTICOS: "Domésticos", ELETRICA: "Elétrica", ELETRICOS: "Elétricos",
  ELETRODOMESTICOS: "Eletrodomésticos", ELETRONICA: "Eletrônica",
  ELETRONICOS: "Eletrônicos", FARMACEUTICA: "Farmacêutica",
  FARMACIA: "Farmácia", GRAFICA: "Gráfica", HIDRAULICA: "Hidráulica",
  HIDRAULICOS: "Hidráulicos", IMOBILIARIA: "Imobiliária",
  INDUSTRIA: "Indústria", INFORMATICA: "Informática",
  LOGISTICA: "Logística", MAQUINAS: "Máquinas", MECANICA: "Mecânica",
  MECANICOS: "Mecânicos", MEDICA: "Médica", MEDICOS: "Médicos",
  METALICA: "Metálica", METALICOS: "Metálicos",
  METALURGICA: "Metalúrgica", MOVEIS: "Móveis", NUTRICAO: "Nutrição",
  ODONTOLOGICA: "Odontológica", ODONTOLOGICO: "Odontológico",
  ORGANICOS: "Orgânicos", PAPEIS: "Papéis", PECAS: "Peças",
  PETROLEO: "Petróleo", PLASTICA: "Plástica", PLASTICOS: "Plásticos",
  PRODUCAO: "Produção", QUIMICA: "Química", QUIMICOS: "Químicos",
  REFRIGERACAO: "Refrigeração", SAUDE: "Saúde", SEGURANCA: "Segurança",
  SERVICO: "Serviço", SERVICOS: "Serviços", TECNICA: "Técnica",
  TECNICOS: "Técnicos", TEXTIL: "Têxtil", VEICULOS: "Veículos",
  VESTUARIO: "Vestuário",
};

// Siglas/formas societárias — ficam como estão (soletrar "Ltda" com L
// maiúsculo só ou minúsculo não muda a fala, e mexer arrisca mais que ajuda).
const SIGLAS = new Set(["LTDA", "ME", "EPP", "EIRELI", "MEI", "SA", "CIA"]);
const CONECTIVOS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "EM", "COM"]);

function normalizarNomeEmpresa(bruto: string): string {
  const nome = (bruto || "").trim().replace(/\s+/g, " ");
  if (!nome) return "";

  // já tem letra minúscula → assume que já veio formatado (ex.: popup de
  // disparo manual, onde o Igor digita o nome certo) e não mexe.
  if (/[a-záàâãéêíóôõúç]/.test(nome)) return nome;

  return nome
    .split(" ")
    .map((palavra, i) => {
      const semPontuacao = palavra.replace(/[^A-ZÇ]/g, "");
      if (DICIONARIO_ACENTOS[semPontuacao]) return DICIONARIO_ACENTOS[semPontuacao];
      if (SIGLAS.has(semPontuacao)) return palavra;
      if (i > 0 && CONECTIVOS.has(semPontuacao)) return palavra.toLowerCase();
      return palavra.charAt(0) + palavra.slice(1).toLowerCase();
    })
    .join(" ");
}

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

  // Impede discagem se a migração não foi aplicada ou o banco está indisponível.
  try {
    const { error: schemaError } = await sb
      .from("np_lead_telefones").select(COLUNAS_CARIMBO).limit(0);
    if (schemaError) throw schemaError;
  } catch {
    return respostaJson({
      ok: false,
      erro: "carimbo_schema_indisponivel: confira a migração e a conexão com o banco; nenhuma ligação disparada",
      processados: 0, ligados: [], pulados: [], falhas: [],
    }, 503);
  }

  const ligados: Record<string, unknown>[] = [];
  const pulados: Record<string, unknown>[] = [];
  const falhas: Record<string, unknown>[] = [];

  let processados = 0;
  let promptBloqueado = false;
  for (let i = 0; i < telefoneIds.length; i++) {
    processados++;
    const telefoneId = telefoneIds[i];
    let tentouDisparar = false;

    try {
      const { data: telefone, error: buscaError } = await sb
        .from("np_lead_telefones")
        .select("id, e164, ia_conversation_id, ia_tentativas, lead_id, np_leads(nome_exibicao, razao_social)")
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
      const briefing = await loadBriefing(sb, telefone.lead_id, lead?.nome_exibicao || lead?.razao_social || "");
      const empresa = normalizarNomeEmpresa(briefing.empresa);
      if (!empresa) {
        pulados.push({ telefoneId, motivo: "empresa_de_referencia_ausente" });
        continue;
      }

      const payload = {
        agent_id: ELEVENLABS_AGENT_ID,
        agent_phone_number_id: ELEVENLABS_AGENT_PHONE_NUMBER_ID,
        to_number: telefone.e164,
        conversation_initiation_client_data: {
          dynamic_variables: { ...briefing, empresa },
        },
      };

      // Sem cache entre telefones/lotes. Se GET/validação falhar, cai no catch
      // antes do POST: nenhuma ligação sai com carimbo ausente/inventado.
      const carimbo = await lerCarimboAgente();
      const disparadoEm = new Date().toISOString();

      tentouDisparar = true;
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

      const gravacao = {
        ia_conversation_id: resBody.conversation_id,
        ia_disparado_em: disparadoEm,
        ia_tentativas: (telefone.ia_tentativas || 0) + 1,
        ...carimbo,
        // Custo será preenchido pelo webhook, pelo conversation_id.
        // Não escrever zero nem usar o preço médio da task anterior.
      };

      try {
        const { data: salvo, error: updateError } = await sb
          .from("np_lead_telefones")
          .update(gravacao)
          .eq("id", telefoneId)
          .select("id")
          .maybeSingle();
        if (updateError) throw new Error(updateError.message);
        if (!salvo) throw new Error("Update não encontrou a linha do telefone");
      } catch (erro) {
        // Já discou. NÃO repetir POST automaticamente. Devolver os dados
        // lidos permite reparar o banco sem consultar um prompt já alterado.
        falhas.push({
          telefoneId,
          e164: telefone.e164,
          motivo: "ligacao_feita_mas_erro_ao_gravar_conversation_id",
          conversationId: resBody.conversation_id,
          erro: erro instanceof Error ? erro.message : String(erro),
          dadosParaRecuperacao: gravacao,
        });
        console.error("[ORQUESTRADOR] Ligação feita; gravação pendente", {
          telefoneId,
          conversationId: resBody.conversation_id,
          promptHash: carimbo.ia_prompt_hash,
        });
        // Para o lote para não acumular chamadas sem registro.
        break;
      }

      ligados.push({
        telefoneId,
        e164: telefone.e164,
        empresa,
        conversationId: resBody.conversation_id,
        promptHash: carimbo.ia_prompt_hash,
        voiceId: carimbo.ia_voice_id,
        llmModel: carimbo.ia_llm_model,
        ttsModel: carimbo.ia_tts_model,
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
      if (erro instanceof PromptGateError) {
        // Para o lote sem perder o carimbo/resultado das chamadas anteriores.
        promptBloqueado = true;
        break;
      }
    } finally {
      // O finally também roda nos caminhos com continue (falha na API).
      if (tentouDisparar && i < telefoneIds.length - 1) {
        await pausa(PAUSA_ENTRE_LIGACOES_MS);
      }
    }
  }

  return respostaJson({
    ok: falhas.length === 0,
    processados,
    pendentes: telefoneIds.slice(processados),
    ligados,
    pulados,
    falhas,
  }, promptBloqueado ? 503 : 200);
});
