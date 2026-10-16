import { registrarCustoDigital } from "../_shared/digital-gasto.ts";
// karla-sdr-webhook — recebe o webhook pós-chamada do agente ElevenLabs "Karla SDR" e, se o
// lead autorizou (data_collection "enviarapresentacao" === true), envia a apresentação em PDF
// via WhatsApp (Evolution API).
//
// SON-3.9: usa o mesmo canal dedicado da tool em tempo real, sem EVOLUTION_INSTANCE.
// O bloqueio por nome e identidade tambem protege este caminho se for reativado.
//
// Autenticação: ElevenLabs assina o corpo com HMAC-SHA256 no header `ElevenLabs-Signature`
// (formato "t=<timestamp>,v0=<hex>", mensagem assinada = "<timestamp>.<corpo_bruto>"). Isso
// segue o padrão documentado da ElevenLabs para post-call webhooks — CONFIRMAR contra a doc
// oficial/um payload real antes de confiar 100%, não vem de teste real ainda.
//
// ⚠️ IMPORTANTE — payload real ainda não foi observado. Os caminhos abaixo
// (`data_collection_results`, `metadata.phone_call.external_number`) são a MELHOR HIPÓTESE
// baseada na estrutura do agente, não confirmação. Por isso a função sempre loga o payload
// bruto (console.error, aparece em `get_logs`/`query_logs`) antes de tentar extrair os campos —
// se o primeiro teste real falhar em extrair o número ou a autorização, o log bruto mostra a
// estrutura verdadeira pra corrigir os caminhos.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { registrarReputacao } from "../_shared/sonar-reputacao.ts";
import { CanalFollowupIndisponivel, prepararCanalFollowup } from "../_shared/sonar-followup.ts";

const CORS = { "Access-Control-Allow-Origin": "*" };
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ELEVENLABS_WEBHOOK_SECRET = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET")!;
// PDF público (Supabase Storage) da apresentação — setar depois do upload.
const APRESENTACAO_URL = Deno.env.get("APRESENTACAO_TENDENCIA_URL")!;

function normalizarNumero(raw: string): string {
  const digitos = raw.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

async function assinaturaValida(req: Request, corpoBruto: string): Promise<boolean> {
  const header = req.headers.get("elevenlabs-signature");
  if (!header) return false;
  const partes = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = partes["t"];
  const hashRecebido = partes["v0"];
  if (!timestamp || !hashRecebido) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(ELEVENLABS_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${corpoBruto}`));
  const hashCalculado = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashCalculado === hashRecebido;
}

// Busca um caminho que pode estar em posições diferentes do payload, sem quebrar se faltar.
function buscar(obj: any, caminhos: string[][]): unknown {
  for (const caminho of caminhos) {
    let atual = obj;
    for (const chave of caminho) {
      atual = atual?.[chave];
      if (atual === undefined) break;
    }
    if (atual !== undefined) return atual;
  }
  return undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const corpoBruto = await req.text();

  if (!(await assinaturaValida(req, corpoBruto))) {
    console.error("karla-sdr-webhook: assinatura inválida ou ausente");
    return json({ error: "assinatura inválida" }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(corpoBruto);
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  // Log bruto sempre — é o que permite corrigir os caminhos abaixo no primeiro teste real.
  console.log("karla-sdr-webhook payload bruto:", JSON.stringify(payload));

  const dados = payload?.data ?? payload;

  // Ingestao autenticada pela assinatura acima. O mesmo conversation_id vindo
  // do webhook LDR e do SDR conta uma unica vez. Nao envia notificacoes.
  if (payload.type === "post_call_transcription") {
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await registrarReputacao(sb, dados);
      await registrarCustoDigital(sb, dados);
    } catch {
      return json({ erro: "Falha ao registrar reputacao; reentrega necessaria" }, 503);
    }
  }

  const coleta = buscar(dados, [
    ["analysis", "data_collection_results"],
    ["data_collection_results"],
    ["analysis", "data_collection"],
  ]) as Record<string, any> | undefined;

  const querApresentacao =
    coleta?.enviarapresentacao?.value === true || coleta?.enviarapresentacao === true;

  if (!querApresentacao) {
    return json({ enviado: false, motivo: "lead não autorizou (ou payload não trouxe a coleta)" });
  }

  const numeroBruto = buscar(dados, [
    ["metadata", "phone_call", "external_number"],
    ["conversation_initiation_client_data", "dynamic_variables", "system__caller_id"],
    ["metadata", "phone_number"],
  ]) as string | undefined;

  if (!numeroBruto) {
    console.error("karla-sdr-webhook: número do lead não encontrado, ver payload bruto no log acima");
    return json({ erro: "número do lead não encontrado no payload" }, 400);
  }

  const numero = normalizarNumero(numeroBruto);

  try {
    const canal = await prepararCanalFollowup((nome) => Deno.env.get(nome));
    const r = await canal.enviarMidia({
      number: numero,
      mediatype: "document",
      mimetype: "application/pdf",
      media: APRESENTACAO_URL,
      fileName: "Apresentacao_Tendencia_Energia.pdf",
      caption: "Segue a apresentação da Tendência Energia que combinamos na ligação!",
    });

    const status = r.status;
    if (!r.ok) console.error("karla-sdr-webhook: envio Evolution falhou", status, await r.text());

    return json({ enviado: r.ok, status, numero });
  } catch (e) {
    if (e instanceof CanalFollowupIndisponivel) {
      return json({ enviado: false, erro: e.message, motivo: e.motivo }, 503);
    }
    console.error("karla-sdr-webhook: falha de rede no canal de follow-up");
    return json({ enviado: false, erro: "falha de rede ao chamar Evolution" }, 502);
  }
});
