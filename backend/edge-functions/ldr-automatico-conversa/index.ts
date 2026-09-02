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
// Deploy COM verificação de JWT (igual o orquestrador) — só usuário logado
// no dashboard chama isto.

function envObrigatoria(nome: string): string {
  const valor = Deno.env.get(nome);

  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }

  return valor;
}

const ELEVENLABS_API_KEY = envObrigatoria("ELEVENLABS_API_KEY");

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
