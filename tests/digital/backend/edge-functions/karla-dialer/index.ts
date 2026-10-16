import { dispararComOrcamento, GastoDigitalBloqueado, maxSegundosAgente } from "./digital-gasto.ts";
// karla-dialer — dispara UMA ligação outbound real da Karla (canal de voz, agente "Karla SDR"
// no ElevenLabs) para o número informado. Ferramenta de teste da tela karla-dialer.html.
//
// Porta server-side do protótipo local ferramentas/karla-dialer/server.py: a xi-api-key não pode
// ir pro front (CLAUDE.md §20). Isolada do LDR Automático de propósito — sem fila, sem lead de
// teste, sem webhook.
//
// ⚠️ Endpoint é o de SIP trunk: o número do agente é do 3CX (provider "sip_trunk"). O endpoint
// /twilio/outbound-call devolve `twilio_number_expected` pra esse número.
//
// 24/09 (SON-1.4): passou a consultar o portão de opt-out (np_fn_pode_contatar) ANTES de
// discar. É o primeiro canal plugado na R4 — antes disso a tabela de opt-out existia e
// ninguém perguntava, o que não protege ninguém. Fail-closed: erro na consulta recusa a
// ligação. Os outros canais (karla-enviar-apresentacao, fin-notificar-whatsapp,
// cadencia-runner) ainda NÃO consultam.
//
// 08/10 (PBT-2.3, achado do gate adversarial): a função aceitava `numero` e `empresa` como
// texto livre, sem checar se eram da mesma empresa de verdade — é o jeito mais provável de
// repetir o bug de 04/08 "confundiu clientes" (número de uma empresa + nome de outra, por erro
// de quem monta a chamada, ex. desalinhamento numa lista). Agora aceita `lead_id`: quando vem,
// número/empresa/CNPJ são buscados no banco, nunca soltos no body — fonte única de verdade.
// `numero`/`empresa` livres continuam funcionando (fallback, não quebra quem já usa assim, ex.
// o CLI do Junior) mas não têm mais essa garantia. `somente_piloto: true` (com `lead_id`) trava
// a ligação a leads com a tag `livre:piloto-b3` — opcional, não muda o comportamento padrão
// desta ferramenta de teste geral.
//
// 09/10 (PBT-2.4, achado real): a regra das 48h (R1 do Projeto Sonar) já existe, codificada e
// testada, em `np_fn_sonar_portao_motivo` — mas só era chamada pelo `ldr-automatico-orquestrador`
// com p_agente='ldr' (o LDR se autolimitando). Nunca era chamada com p_agente='sdr' em lugar
// nenhum do sistema, então nada impedia discar a Karla pra um número que o LDR tinha acabado de
// validar. Achado concreto do dia: a ERVATEIRA TOMELERO LTDA (lead do piloto) recebeu 2 ligações
// de validação no mesmo dia — uma do LDR Automático real, outra de um teste manual nosso — porque
// nenhum portão unificado existia. Agora, quando `lead_id` vem com CNPJ resolvido, consulta o
// mesmo portão com p_agente='sdr' antes de discar. Fail-closed, mesmo padrão do opt-out.
//
// 13/10 (PBT-3.3, subtarefa 4): até aqui, mesmo pra leads do piloto B3 optante (tag
// `livre:piloto-b3`), a ligação sempre usava o agente genérico "Karla SDR" — nunca o agente
// "Karla — Piloto B3 optante (teste)" que tem o roteiro adaptado pro piloto (pede a fatura
// explicando o número de WhatsApp da KarlaAndradeV2, trata a pergunta de migração pro mercado
// livre, etc). Resultado: não existia nenhum caminho de PRODUÇÃO (com as proteções de opt-out,
// 48h e anti-duplicata desta function) que usasse o agente certo — só dava pra testar via uma
// function de teste separada, sem proteção nenhuma. Agora, quando o lead tem a tag
// `livre:piloto-b3`, a ligação usa o agente do piloto automaticamente; os demais leads continuam
// no "Karla SDR" de sempre.
//
// 14/10 (PBT-2.4, seção 9 — regressão achada e corrigida): a consulta ao portão (09/10, acima)
// resolveu só metade do problema. Esta function nunca ESCREVIA no histórico que o próprio portão
// lê (`vw_np_sonar_contatos_cnpj`) — uma ligação do SDR não deixava rastro nenhum pro Sonar.
// Provado ao vivo: minutos depois de discar pra 12 CNPJs reais do piloto, o portão continuava
// respondendo 'ok' pra eles, como se nada tivesse acontecido. Causa: a view só tinha os ramos
// 'ldr' (np_ldr_conversas) e 'humano' (np_acoes tipo='ligacao' origem='agente') — nenhum para o
// robô SDR. Migration separada abriu o ramo 'sdr' lendo np_acoes origem='sistema'+tipo='ligacao'
// (combinação que nunca existia antes, exclusiva do robô). Agora, depois de toda ligação aceita
// pelo ElevenLabs com CNPJ resolvido, grava essa linha — best-effort (nunca derruba a resposta:
// a ligação já saiu de verdade nesse ponto, uma falha ao logar não pode virar "ligação falhou").
//
// 14/10, mesmo dia (achado 2 — falha técnica do tronco 3CX): medido ao vivo que ~52% das
// ligações de hoje nunca alcançaram o lead — o ElevenLabs aceita o disparo (HTTP 200) e devolve
// conversation_id normalmente, mas a "conversa" captura literalmente a mensagem de erro do 3CX
// ("cannot reach the number you called" / "destino não está disponível... não há rotas
// disponíveis"), com a ligação durando uns 7-8s. Contar isso como tentativa real no portão da
// seção acima queimaria o teto de 3 tentativas do SDR (R2a) sem o telefone do lead nunca ter
// tocado — pior que não ter o conserto de hoje de manhã. Agora, ~15s depois do disparo, em
// segundo plano (EdgeRuntime.waitUntil — não atrasa a resposta pra quem chamou), confere o
// resultado real na ElevenLabs; se bater com a assinatura conhecida da falha do 3CX, marca
// `np_acoes.resultado='falha_tecnica_3cx'` nessa linha (migration separada fez a view do Sonar
// excluir esse resultado do ramo 'sdr'). Fail-safe: se a checagem falhar por qualquer motivo, a
// linha fica sem marca e CONTINUA contando — errar pro lado de "conta como tentativa" é o lado
// seguro pra compliance, não o inverso. Causa raiz (por que o 3CX falha ~metade das vezes) é
// infraestrutura de telefonia, fora do alcance desta function — fica com quem cuida do 3CX.
// DIG-3.3: reconciled with published v39 on 2026-10-16.
import { conferirPortoesDigital, conferirVersaoDigital, prepararContextoDigital, type DigitalContext } from "./digital.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Inlined de ../_shared/sonar-reputacao.ts (SON-2.8) — o bundler de deploy desta function não
// resolve import relativo pra fora da própria pasta quando deployada via API de Management
// (mesmo problema já documentado no whatsapp-fatura). Lógica idêntica à do arquivo compartilhado.
class ReputacaoBloqueada extends Error {}

function normalizarOrigem(value: unknown): string {
  const number = typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error("numero de origem ausente ou invalido");
  return number;
}

async function buscarOrigem(apiKey: string, phoneId: string, base = "https://api.elevenlabs.io") {
  const response = await fetch(`${base}/v1/convai/phone-numbers/${encodeURIComponent(phoneId)}`, {
    headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`origem_indisponivel: HTTP ${response.status}`);
  const body = await response.json();
  if (body.phone_number_id !== phoneId) throw new Error("identidade da origem divergente");
  return normalizarOrigem(body.phone_number);
}

// deno-lint-ignore no-explicit-any
async function conferirReputacao(sb: any, origem: string) {
  const { data, error } = await sb.rpc("np_fn_sonar_reputacao_portao", { p_origem: origem });
  if (error || !data || typeof data.permitido !== "boolean") {
    throw new ReputacaoBloqueada("Monitor de reputacao indisponivel; nenhuma nova chamada autorizada");
  }
  if (data.permitido !== true) {
    throw new ReputacaoBloqueada(data.motivo_bloqueio || "Origem bloqueada pelo monitor de reputacao");
  }
  return data;
}

// PBT-3.3: dois agentes possíveis — o genérico (padrão) e o do piloto B3 optante, escolhido pela
// tag do lead. AGENT_PHONE_NUMBER_ID é o mesmo recurso de telefonia (SIP trunk) pros dois —
// não é específico de agente.
const AGENT_ID_PADRAO = "agent_2101m2g5f58pezvvdcpcztnv1f41"; // Karla SDR
const AGENT_ID_PILOTO_B3 = "agent_0701m4bxk2hvfwzvqcegk7cjdkg0"; // Karla — Piloto B3 optante (teste)
const TAG_SLUG_PILOTO_B3 = "livre:piloto-b3";
const AGENT_PHONE_NUMBER_ID = "phnum_3501m20r0z8hfx0acqmej77skbtk";
const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function normalizePhone(numero: string): string {
  const d = String(numero || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) return `+${d}`;
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  return `+${d}`;
}

// deno-lint-ignore no-explicit-any
async function leadTemTagPilotoB3(sb: any, leadId: string): Promise<boolean> {
  const { data } = await sb
    .from("np_lead_tags")
    .select("tag_id, np_tags!inner(slug)")
    .eq("lead_id", leadId)
    .eq("np_tags.slug", TAG_SLUG_PILOTO_B3)
    .maybeSingle();
  return !!data;
}

// Transcrição/áudio de uma ligação já discada (17/09, pedido do Junior — histórico no PWA).
// Busca ao vivo na ElevenLabs pelo conversation_id que o disparo devolveu; nenhum dos dois fica
// guardado no nosso banco, só consultados sob demanda quando o usuário abre a ligação.
async function buscarTranscricao(conversationId: string, apiKey: string): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const erro = `Erro de rede ao consultar o ElevenLabs: ${e instanceof Error ? e.message : String(e)}`;
    return json({ ok: false, erro }, 502);
  }

  const texto = await resp.text();
  let dados: Record<string, unknown> = {};
  try { dados = JSON.parse(texto); } catch (_) { /* corpo não-JSON: repassa o texto cru */ }
  if (!resp.ok) return json({ ok: false, erro: texto || `HTTP ${resp.status}` }, resp.status);

  const transcriptRaw = Array.isArray(dados.transcript) ? dados.transcript : [];
  const transcript = transcriptRaw.map((t: Record<string, unknown>) => ({
    papel: t.role === "agent" ? "karla" : "lead",
    texto: String(t.message ?? t.text ?? ""),
    segundos: typeof t.time_in_call_secs === "number" ? t.time_in_call_secs : null,
  }));
  const metadata = (dados.metadata as Record<string, unknown>) || {};

  return json({
    ok: true,
    status: String(dados.status || ""),
    duracao_segundos: typeof metadata.call_duration_secs === "number" ? metadata.call_duration_secs : null,
    transcript,
  });
}

// Áudio da gravação (só existe se a retenção de áudio estiver habilitada no agente). Faz stream
// direto do corpo da resposta da ElevenLabs — não bufferiza o arquivo inteiro em memória.
async function buscarAudio(conversationId: string, apiKey: string): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    const erro = `Erro de rede ao buscar o áudio: ${e instanceof Error ? e.message : String(e)}`;
    return json({ ok: false, erro }, 502);
  }
  if (!resp.ok) {
    const texto = await resp.text();
    return json({ ok: false, erro: texto || `HTTP ${resp.status}` }, resp.status);
  }
  return new Response(resp.body, {
    status: 200,
    headers: { ...CORS, "Content-Type": resp.headers.get("content-type") || "audio/mpeg" },
  });
}

// deno-lint-ignore no-explicit-any
async function handleGet(req: Request, sb: any): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, erro: "Não autenticado" }, 401);
  const { data: { user }, error: authErr } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (authErr || !user) return json({ ok: false, erro: "Token inválido" }, 401);

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id") || "";
  if (!conversationId.trim()) return json({ ok: false, erro: "Parâmetro 'conversation_id' obrigatório" }, 400);

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY") || "";
  if (!apiKey) return json({ ok: false, erro: "ELEVENLABS_API_KEY não configurada" }, 500);

  if (url.searchParams.get("audio")) return buscarAudio(conversationId, apiKey);
  return buscarTranscricao(conversationId, apiKey);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  if (req.method === "GET") return handleGet(req, sb);
  if (req.method !== "POST") return json({ ok: false, erro: "Use POST ou GET" }, 405);

  // Caminho alternativo p/ teste manual via curl/CLI (17/09, a pedido do Junior — ele não
  // tinha um jeito rápido de disparar sem passar pelo app/token de sessão). Cabeçalho
  // próprio, não é o Authorization do app — nunca usar no frontend, só CLI/curl.
  const testeSecret = req.headers.get("x-teste-secret");
  let userEmail: string | null;
  if (testeSecret && testeSecret === "7YCREzY_895Ble3Wp7uGoc6CGT-oKfb2") {
    userEmail = "teste-manual-cli";
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, erro: "Não autenticado" }, 401);
    const { data: { user }, error: authErr } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (authErr || !user) return json({ ok: false, erro: "Token inválido" }, 401);
    userEmail = user.email ?? null;
  }

  const body = await req.json().catch(() => ({}));
  const ehDigital = body?.projeto === "digital";
  if (body?.projeto != null && !ehDigital) return json({ ok: false, erro: "Projeto de voz desconhecido" }, 400);
  if (ehDigital && !body?.lead_id) return json({ ok: false, erro: "Digital exige lead_id" }, 400);

  // PBT-2.3: quando lead_id vem, numero/empresa/cnpj são sempre lidos do banco — nunca soltos
  // no body. Sem lead_id, cai no comportamento antigo (fallback, não quebra quem já usa assim).
  const leadId = String(body?.lead_id || "").trim() || null;
  let numeroRaw: string;
  let empresa: string;
  let cnpjRaw: string | null;
  let leadIdResolvido: string | null = null;

  if (leadId) {
    const { data: lead, error: leadErr } = await sb
      .from("np_leads")
      .select("id, telefone, razao_social, cnpj")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return json({ ok: false, erro: `Lead '${leadId}' não encontrado` }, 404);
    if (!lead.telefone) return json({ ok: false, erro: `Lead '${leadId}' não tem telefone cadastrado` }, 400);

    numeroRaw = String(lead.telefone);
    empresa = String(lead.razao_social || "").trim() || "empresa";
    cnpjRaw = lead.cnpj ? String(lead.cnpj) : null;
    leadIdResolvido = String(lead.id);
  } else {
    numeroRaw = String(body?.numero || "").trim();
    empresa = String(body?.empresa || "").trim() || "empresa";
    cnpjRaw = String(body?.cnpj || "").trim() || null;
  }
  if (!numeroRaw) return json({ ok: false, erro: "Campo 'numero' ou 'lead_id' obrigatório" }, 400);

  const toNumber = normalizePhone(numeroRaw);

  // DIG-3.2: body não libera região, agenda ou branch. Cadastro/validação vêm do servidor.
  let digital: DigitalContext | null = null;
  if (ehDigital) {
    if (Deno.env.get("KARLA_DIGITAL_ENABLED") !== "true") return json({ ok: false, erro: "Digital ainda não liberado para discagem" }, 403);
    if (!cnpjRaw) return json({ ok: false, erro: "Digital exige CNPJ vinculado ao lead" }, 400);
    if (body?.somente_piloto === true) return json({ ok: false, erro: "Digital não aceita roteamento somente_piloto" }, 400);
    try {
      const { data: contexto, error: contextoErr } = await sb.rpc("np_fn_digital_contexto", {
        p_lead: leadIdResolvido,
      });
      if (contextoErr) return json({ ok: false, erro: "Fonte de contexto Digital indisponível" }, 503);
      digital = prepararContextoDigital({
        leadId: leadIdResolvido, empresa,
        enabled: Deno.env.get("KARLA_DIGITAL_ENABLED"),
        contexto,
      });
    } catch (e) {
      return json({ ok: false, erro: e instanceof Error ? e.message : "Contexto Digital indisponível" }, 403);
    }
    const { data: confirmado, error: telErr } = await sb.from("np_lead_telefones")
      .select("id").eq("lead_id", leadIdResolvido).eq("e164", toNumber)
      .eq("ia_resultado", "confirmado").eq("morto", false).limit(1);
    if (telErr || !confirmado?.length) return json({ ok: false, erro: "Telefone Digital sem confirmação LDR para este lead" }, 403);
    const { data: janela, error: janelaErr } = await sb.rpc("np_fn_sonar_janela_discagem", { p_e164: toNumber });
    const { data: degraus, error: degrauErr } = await sb.rpc("np_fn_sonar_degrau_atual");
    if (janelaErr || degrauErr) return json({ ok: false, erro: "Portões Digital indisponíveis" }, 503);
    try { conferirPortoesDigital(janela, degraus); }
    catch (e) { return json({ ok: false, erro: e instanceof Error ? e.message : "Discagem Digital bloqueada" }, 403); }
  }

  // PBT-3.3: checa a tag do piloto uma vez só, usada tanto pra travar somente_piloto quanto
  // pra escolher o agente certo mais abaixo.
  const ehPilotoB3 = leadIdResolvido ? await leadTemTagPilotoB3(sb, leadIdResolvido) : false;

  // Best-effort: cada clique disca um telefone real e custa, e a tela é aberta a qualquer logado.
  const auditar = async (nivel: "info" | "error", status: number, extra: Record<string, unknown>) => {
    try {
      await sb.from("np_logs").insert({
        origem: "edge",
        nivel,
        categoria: "karla-dialer",
        acao: "disparo_ligacao",
        detalhe: nivel === "info" ? `Ligação disparada para ${toNumber}` : `Falha ao ligar para ${toNumber}`,
        status,
        user_email: userEmail,
        ...(digital ? { lead_id: leadIdResolvido, cnpj: cnpjRaw } : {}),
        payload: { numero: toNumber, empresa, lead_id: leadIdResolvido, piloto_b3: ehPilotoB3,
          ...(digital ? { projeto: "digital", branch_id: digital.branch_id, grupo: digital.dynamic_variables.grupo, regiao: digital.dynamic_variables.regiao } : {}), ...extra },
      });
    } catch (_) { /* log não pode derrubar a resposta */ }
  };

  // Assinatura conhecida da falha do tronco 3CX (achado 14/10): a "conversa" captura
  // literalmente a mensagem de erro, em inglês ou português (a ASR garante o "3CX" de formas
  // diferentes a cada vez — "CX", "CCX", "The X", "Three CX" — por isso o match é pela frase
  // completa, não pela sigla).
  function pareceFalhaTecnica3cx(transcript: unknown, duracaoSegundos: unknown): boolean {
    if (typeof duracaoSegundos === "number" && duracaoSegundos > 12) return false;
    if (!Array.isArray(transcript)) return false;
    const texto = transcript.map((t: Record<string, unknown>) => String(t?.message ?? t?.text ?? "")).join(" ").toLowerCase();
    return texto.includes("cannot reach the number you called")
      || texto.includes("não está disponível")
      || texto.includes("não há rotas dispon");
  }

  // 14/10 (PBT-2.4, seção 9): registra o contato no histórico que o portão do Sonar lê
  // (vw_np_sonar_contatos_cnpj, ramo 'sdr'). Só roda com CNPJ resolvido — mesma condição da
  // checagem do portão logo abaixo. Best-effort de propósito: a ligação JÁ foi aceita pelo
  // ElevenLabs nesse ponto — uma falha aqui nunca pode virar "ligação falhou" pra quem chamou.
  //
  // Depois de inserir, agenda (EdgeRuntime.waitUntil, sem atrasar a resposta) uma checagem em
  // segundo plano ~15s depois: se a ligação bateu com a assinatura da falha do 3CX, marca
  // resultado='falha_tecnica_3cx' nessa mesma linha — a view do Sonar já exclui esse resultado
  // do ramo 'sdr', então a tentativa não é descontada do teto de 3 do lead.
  const registrarContatoSonar = async (conversationId: string) => {
    if (!cnpjRaw) return;
    let acaoId: number | null = null;
    try {
      const { data } = await sb.from("np_acoes").insert({
        lead_id: leadIdResolvido,
        cnpj: cnpjRaw,
        tipo: "ligacao",
        origem: "sistema",
        agente: "Karla SDR (robô)",
        descricao: `Ligação via karla-dialer, agente ElevenLabs ${agentId}, conversation_id ${conversationId}`,
      }).select("id").maybeSingle();
      acaoId = data?.id ?? null;
    } catch (e) {
      console.error("karla-dialer: falha ao registrar contato no portao Sonar (nao bloqueia a resposta)", e);
      return;
    }
    if (acaoId === null) return;

    const confirmarResultado = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`, {
          headers: { "xi-api-key": apiKey },
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) return;
        const dados = await r.json().catch(() => ({}));
        const duracao = dados?.metadata?.call_duration_secs;
        if (pareceFalhaTecnica3cx(dados?.transcript, duracao)) {
          await sb.from("np_acoes").update({ resultado: "falha_tecnica_3cx" }).eq("id", acaoId);
        }
      } catch (e) {
        console.error("karla-dialer: checagem de falha tecnica 3cx falhou (linha continua contando, lado seguro)", e);
      }
    };
    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(confirmarResultado());
    else confirmarResultado(); // ambiente sem EdgeRuntime (ex.: teste local) — fallback raro
  };

  // PBT-2.3: trava opcional de broadcast. Só bloqueia quando o chamador pede explicitamente
  // (somente_piloto: true, exige lead_id) — não restringe por padrão, porque esta função
  // também serve pra teste manual fora do piloto.
  if (leadIdResolvido && body?.somente_piloto === true && !ehPilotoB3) {
    const erro = `Lead '${leadIdResolvido}' não tem a tag 'livre:piloto-b3' — ligação recusada (somente_piloto=true).`;
    await auditar("error", 403, { erro, etapa: "trava_piloto" });
    return json({ ok: false, erro }, 403);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PORTÃO DE OPT-OUT — SON-1.4, regra R4 do Projeto Sonar (migration 0381)
  // ─────────────────────────────────────────────────────────────────────────────
  // Vem ANTES da trava anti-duplicata de propósito: a trava grava um timestamp de "já
  // discou para este número", e não faz sentido registrar tentativa para alguém que nunca
  // deveria ser discado.
  //
  // FAIL-CLOSED DE VERDADE: qualquer falha aqui — RPC fora do ar, rede, permissão, número
  // que não normaliza — RECUSA a ligação. É o critério (c) da SON-1.4: "consulta
  // indisponível ⇒ não disca". O contrário, deixar passar quando não deu pra verificar,
  // transforma um incidente de infraestrutura em violação de compliance.
  //
  // Repare no `!== true`: não basta "não deu erro". Se o portão devolver null por qualquer
  // motivo, a ligação é recusada. Um `if (podeContatar === false)` deixaria null passar.
  //
  // np_fn_pode_contatar levanta exceção quando o CNPJ vem preenchido mas inválido — isso
  // chega aqui como optErr e bloqueia, que é o comportamento certo: CNPJ digitado errado
  // significa que não sabemos qual empresa é, não que ela está liberada.
  const { data: podeContatar, error: optErr } = await sb.rpc("np_fn_pode_contatar", {
    p_e164: toNumber,
    p_cnpj: cnpjRaw,
  });
  if (optErr) {
    const erro = `Não foi possível verificar o opt-out — ligação recusada por segurança (fail-closed). Detalhe: ${optErr.message}`;
    await auditar("error", 503, { erro, etapa: "opt_out", cnpj: cnpjRaw });
    return json({ ok: false, erro }, 503);
  }
  if (podeContatar !== true) {
    const erro = "Este número — ou o CNPJ desta empresa — pediu para não ser contatado. Ligação bloqueada (opt-out, SON-1.4).";
    await auditar("error", 403, { erro, etapa: "opt_out", cnpj: cnpjRaw, bloqueado: true });
    return json({ ok: false, erro }, 403);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PORTÃO DAS 48H + TETO DE TENTATIVAS — SON-1.7, regras R1/R2 do Projeto Sonar
  // ─────────────────────────────────────────────────────────────────────────────
  // PBT-2.4 (09/10): a função já existe e já é usada pelo ldr-automatico-orquestrador —
  // mas só com p_agente='ldr'. Nunca era chamada com 'sdr' em lugar nenhum, então nada
  // impedia a Karla ligar pra um número que o LDR tinha acabado de validar. Achado real:
  // a ERVATEIRA TOMELERO LTDA recebeu 2 ligações de validação no mesmo dia por falta
  // exatamente deste portão. Só roda quando há CNPJ resolvido (via lead_id) — sem CNPJ não
  // dá pra calcular a raiz, e a função não aceita e164 como alternativa. Mesmo padrão
  // fail-closed do opt-out: erro na consulta recusa a ligação.
  if (cnpjRaw) {
    const { data: motivoPortao, error: portaoErr } = await sb.rpc("np_fn_sonar_portao_motivo", {
      p_cnpj: cnpjRaw,
      p_agente: "sdr",
    });
    if (portaoErr) {
      const erro = `Não foi possível verificar o portão das 48h/tentativas — ligação recusada por segurança (fail-closed). Detalhe: ${portaoErr.message}`;
      await auditar("error", 503, { erro, etapa: "sonar_portao_48h", cnpj: cnpjRaw });
      return json({ ok: false, erro }, 503);
    }
    if (motivoPortao !== "ok") {
      const motivos: Record<string, string> = {
        dentro_48h: "Este CNPJ foi validado pelo LDR há menos de 48h — ligação bloqueada (regra R1 das 48h).",
        teto_tentativas_agente: "Este CNPJ já atingiu o teto de 3 tentativas do SDR — ligação bloqueada (regra R2a).",
        teto_180_dias: "Este CNPJ já atingiu o teto de 6 contatos em 180 dias — ligação bloqueada (regra R2b).",
      };
      const erro = motivos[String(motivoPortao)] || `Ligação bloqueada pelo portão das 48h/tentativas (motivo: ${motivoPortao}).`;
      await auditar("error", 403, { erro, etapa: "sonar_portao_48h", cnpj: cnpjRaw, motivo: motivoPortao });
      return json({ ok: false, erro }, 403);
    }
  }

  // Trava anti-duplicata (17/09) — achado real, confirmado também pela sessão irmã (nexiplay-ca)
  // no dialer local dela: a API do ElevenLabs pode demorar mais que o timeout do fetch pra
  // responder, mas a ligação JÁ foi criada do lado deles. Sem isto, o app mostra erro, a pessoa
  // clica de novo, e o mesmo número recebe DUAS ligações reais. A trava marca o timestamp ANTES
  // de chamar o ElevenLabs, então mesmo um timeout continua bloqueando a retentativa dentro da
  // janela (90s). Ver migration 0344_np_karla_dialer_locks.sql.
  const JANELA_ANTIDUPLICATA_S = 90;
  const { data: podeDiscar, error: lockErr } = await sb.rpc("np_fn_karla_dialer_tentar_lock", {
    p_numero: toNumber,
    p_janela_segundos: JANELA_ANTIDUPLICATA_S,
  });
  if (!lockErr && podeDiscar === false) {
    const erro = `Já foi discado para este número há menos de ${JANELA_ANTIDUPLICATA_S}s — a ligação provavelmente já foi criada. Não disque de novo, espere o telefone tocar.`;
    await auditar("error", 429, { erro });
    return json({ ok: false, erro }, 429);
  }
  if (digital && (lockErr || podeDiscar !== true)) {
    await auditar("error", 503, { etapa: "lock_digital", erro: "Trava anti-duplicata indisponível" });
    return json({ ok: false, erro: "Trava anti-duplicata Digital indisponível" }, 503);
  }
  if (lockErr) console.error("karla-dialer: trava anti-duplicata falhou, seguindo sem ela", lockErr);

  // Mesmo secret que o ldr-automatico-orquestrador já usa em produção (conferido em
  // get_edge_function em 17/09) — projeto-wide, não precisa duplicar/renomear.
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY") || "";
  if (!apiKey) {
    const erro = "ELEVENLABS_API_KEY não configurada — cadastrar em Supabase → Edge Functions → Secrets";
    await auditar("error", 500, { erro });
    return json({ ok: false, erro }, 500);
  }

  // PBT-3.3: agente escolhido pela tag do lead — piloto B3 optante usa o roteiro adaptado,
  // todos os outros continuam no Karla SDR genérico.
  const agentId = digital ? AGENT_ID_PADRAO : ehPilotoB3 ? AGENT_ID_PILOTO_B3 : AGENT_ID_PADRAO;

  // Timeout 15s → 45s (17/09): 15s era curto demais pro sip-trunk/outbound-call e estava sendo
  // a própria causa do disparo duplicado (ver comentário da trava acima). Em timeout, a mensagem
  // deixa de ser um erro genérico — avisa explicitamente que a ligação PROVAVELMENTE já saiu.
  let resp: Response;
  try {
    const origem = await buscarOrigem(apiKey, AGENT_PHONE_NUMBER_ID);
    await conferirReputacao(sb, origem);
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Monitor de reputacao indisponivel";
    await auditar("error", 503, { erro, etapa: "reputacao" });
    return json({ ok: false, erro, etapa: "reputacao" }, 503);
  }
  try {
    let maxSegundos: number | null = null;
    if (digital) {
      const agentResponse = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}?branch_id=${encodeURIComponent(digital.branch_id)}`, {
        headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(10_000),
      });
      if (!agentResponse.ok) throw new GastoDigitalBloqueado("Duração máxima do agente indisponível");
      const agente = await agentResponse.json();
      try { conferirVersaoDigital(agente, digital.branch_id); }
      catch { throw new GastoDigitalBloqueado("Versão Digital diverge da suíte aprovada"); }
      maxSegundos = maxSegundosAgente(agente.conversation_config);
    }
    const payload = {
      agent_id: agentId, agent_phone_number_id: AGENT_PHONE_NUMBER_ID, to_number: toNumber,
      conversation_initiation_client_data: digital ?? { dynamic_variables: { empresa } },
    };
    resp = await dispararComOrcamento(sb, {
      leadId: leadIdResolvido, e164: toNumber, engine: "sdr", maxSegundos, exigirDigital: ehDigital,
    }, payload, (payloadReservado) => fetch(ELEVENLABS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify(payloadReservado),
      signal: AbortSignal.timeout(45_000),
    }));
  } catch (e) {
    if (e instanceof GastoDigitalBloqueado) {
      await auditar("error", 503, { erro: e.message, etapa: "orcamento_digital" });
      return json({ ok: false, erro: e.message, etapa: "orcamento_digital" }, 503);
    }
    const foiTimeout = e instanceof Error && e.name === "TimeoutError";
    const erro = foiTimeout
      ? "O ElevenLabs demorou pra responder, mas a ligação PROVAVELMENTE JÁ FOI CRIADA. Não clique de novo — aguarde o telefone tocar."
      : `Erro de rede ao chamar o ElevenLabs: ${e instanceof Error ? e.message : String(e)}`;
    await auditar("error", foiTimeout ? 504 : 502, { erro, timeout: foiTimeout });
    return json({ ok: false, erro }, foiTimeout ? 504 : 502);
  }

  const texto = await resp.text();
  let dados: Record<string, unknown> = {};
  try { dados = JSON.parse(texto); } catch (_) { /* corpo não-JSON: repassa o texto cru */ }

  // A API pode responder 200 com success:false — não confiar só no status HTTP.
  if (!resp.ok || dados.success === false) {
    const erro = texto || `HTTP ${resp.status}`;
    await auditar("error", resp.status, { erro });
    return json({ ok: false, erro }, resp.ok ? 502 : resp.status);
  }

  const conversationId = String(dados.conversation_id || "");
  await auditar("info", resp.status, { conversation_id: conversationId });
  await registrarContatoSonar(conversationId);
  return json({ ok: true, numero: toNumber, empresa, lead_id: leadIdResolvido, agente: agentId, piloto_b3: ehPilotoB3,
    ...(digital ? { projeto: "digital", branch_id: digital.branch_id } : {}), conversation_id: conversationId });
});
