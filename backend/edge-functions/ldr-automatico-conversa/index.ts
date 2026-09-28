// LDR Automático — proxy pra buscar o transcript de UMA ligação já feita,
// direto do painel (botão "Ver conversa" na lista de chamadas).
//
// Existe só porque a API do ElevenLabs exige a API key (secret, nunca pode
// ir pro browser) — este endpoint fica entre o dashboard e o ElevenLabs,
// devolvendo só o que o painel precisa mostrar (status, transcript,
// duração), sem expor a key.
//
// Entrada:  POST { conversation_id: string }
// Saída:    { ok, status, duracao_seg, transcript: [{ role, mensagem, seg }] }
//
// Deploy COM verificação de JWT (igual o orquestrador). Mas estar logado
// não basta: SON-2.11.
//
// Até 28/09/2026 qualquer usuário autenticado lia qualquer transcript por
// aqui, sem checagem de papel. Com a conversa agora guardada em casa e a RLS
// de np_ldr_conversas restrita a super_admin e gestor, deixar esta porta
// aberta tornaria a restrição cosmética — quem quisesse ler passaria por
// este caminho.
//
// A autorização pergunta a MESMA função que a RLS usa
// (np_fn_ldr_conversas_leitor), com o JWT de quem chamou. Uma lista de
// papéis copiada aqui viraria uma segunda política, e políticas duplicadas
// divergem: mudar np_ldr_conversas_politica passaria a valer para a tabela
// e não para o proxy.

import { createClient } from "npm:@supabase/supabase-js@2";

function envObrigatoria(nome: string): string {
  const valor = Deno.env.get(nome);

  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }

  return valor;
}

const ELEVENLABS_API_KEY = envObrigatoria("ELEVENLABS_API_KEY");
const SUPABASE_URL = envObrigatoria("SUPABASE_URL");
// Injetada pela plataforma em toda edge; é pública por construção (vive no
// frontend). Quem autoriza é o JWT de quem chamou, não esta chave.
const SUPABASE_ANON_KEY = envObrigatoria("SUPABASE_ANON_KEY");

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

  const conversationId = body?.conversation_id;

  if (typeof conversationId !== "string" || !conversationId) {
    return respostaJson({ ok: false, erro: "conversation_id obrigatório" }, 400);
  }

  // Quem pode ler? A mesma resposta que a tabela dá.
  const autorizacao = req.headers.get("Authorization");
  if (!autorizacao) {
    return respostaJson({ ok: false, erro: "nao_autenticado" }, 401);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: autorizacao } },
  });
  const { data: podeLer, error: erroPapel } = await sb.rpc("np_fn_ldr_conversas_leitor");

  if (erroPapel) {
    // Falha ao decidir NÃO libera: sem resposta da política, a resposta é não.
    console.error("[CONVERSA] Não foi possível apurar o papel", erroPapel.message);
    return respostaJson({ ok: false, erro: "autorizacao_indisponivel" }, 503);
  }

  if (podeLer !== true) {
    console.log("[CONVERSA] Leitura negada pela política", { conversationId });
    return respostaJson({ ok: false, erro: "sem_permissao_para_ler_conversa" }, 403);
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    { headers: { "xi-api-key": ELEVENLABS_API_KEY } },
  );

  const resBody = await res.json().catch(() => null);

  if (!res.ok || !resBody) {
    return respostaJson(
      { ok: false, erro: "elevenlabs_erro", status: res.status, resposta: resBody },
      502,
    );
  }

  // deno-lint-ignore no-explicit-any
  const transcriptBruto = Array.isArray(resBody.transcript) ? resBody.transcript as any[] : [];
  const transcript = transcriptBruto.map((turno) => ({
    role: turno.role === "agent" ? "robo" : "empresa",
    mensagem: turno.message || "",
    seg: turno.time_in_call_secs ?? null,
  }));

  return respostaJson({
    ok: true,
    status: resBody.status || null,
    duracao_seg: resBody.call_duration_secs ?? null,
    transcript,
  });
});
