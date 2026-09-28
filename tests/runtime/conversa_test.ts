// SON-2.11 — o proxy de transcript deixou de ser porta aberta.
//
// Até 28/09/2026 qualquer usuário autenticado lia qualquer conversa por aqui.
// Com a conversa guardada em casa e a RLS restrita a super_admin e gestor, esta
// porta tornava a restrição cosmética.
//
// O que se prova aqui é uma coisa só, em várias formas: **nada sai para a
// ElevenLabs antes de a política dizer sim**. Um portão que consulta depois de
// vazar não é portão.

import assert from "node:assert/strict";
import { withEdge, type Query } from "./harness.ts";
import { ultimosArgs } from "./supabase-stub.ts";

const JWT = "Bearer jwt-do-usuario";

type Saida = { status: number; corpo: Record<string, unknown>; buscou: boolean };

async function pedir(opts: {
  papel?: unknown;
  erroPapel?: { message: string };
  semAutorizacao?: boolean;
} = {}): Promise<Saida> {
  let buscou = false;
  let status = 0;
  let corpo!: Record<string, unknown>;

  await withEdge("ldr-automatico-conversa", {
    db(q: Query) { throw new Error(`Consulta inesperada: ${q.table}`); },
    rpc(name: string) {
      assert.equal(name, "np_fn_ldr_conversas_leitor",
        "o proxy tem que perguntar a MESMA função que a RLS usa");
      if (opts.erroPapel) return { data: null, error: opts.erroPapel };
      return { data: opts.papel ?? false, error: null };
    },
    fetch: ((input: string | URL | Request) => {
      buscou = true;
      assert.match(String(input), /api\.elevenlabs\.io/);
      return Promise.resolve(Response.json({
        status: "done", call_duration_secs: 42,
        transcript: [{ role: "agent", message: "Oi", time_in_call_secs: 0 }],
      }));
    }) as unknown as typeof fetch,
  }, async (handle) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!opts.semAutorizacao) headers.Authorization = JWT;
    const res = await handle(new Request("https://edge.invalid", {
      method: "POST", headers,
      body: JSON.stringify({ conversation_id: "conv_1" }),
    }));
    status = res.status;
    corpo = await res.json();
  });

  return { status, corpo, buscou };
}

// ---------------------------------------------------------------------------
Deno.test("sem Authorization: 401 e nada sai para a ElevenLabs", async () => {
  const r = await pedir({ semAutorizacao: true, papel: true });
  assert.equal(r.status, 401);
  assert.equal(r.corpo.erro, "nao_autenticado");
  assert.equal(r.buscou, false);
});

Deno.test("logado mas sem o papel: 403, e a ElevenLabs nem é consultada", async () => {
  const r = await pedir({ papel: false });
  assert.equal(r.status, 403);
  assert.equal(r.corpo.erro, "sem_permissao_para_ler_conversa");
  assert.equal(r.buscou, false, "um portão que consulta depois de vazar não é portão");
});

Deno.test("com o papel: passa e devolve o transcript normalizado", async () => {
  const r = await pedir({ papel: true });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.buscou, true);
  assert.deepEqual(r.corpo.transcript, [{ role: "robo", mensagem: "Oi", seg: 0 }]);
});

Deno.test("política indisponível nega: falha ao decidir não é permissão", async () => {
  // Fail-closed. Se a resposta fosse liberar, uma instabilidade no banco viraria
  // acesso aberto a gravação de voz — e ninguém perceberia, porque a tela
  // continuaria funcionando.
  const r = await pedir({ erroPapel: { message: "sem conexao" } });
  assert.equal(r.status, 503);
  assert.equal(r.corpo.erro, "autorizacao_indisponivel");
  assert.equal(r.buscou, false);
});

Deno.test("valores que não são exatamente `true` não liberam", async () => {
  // A RPC devolve booleano. Qualquer outra coisa — null por RLS, string, 1 —
  // significa que a pergunta não foi respondida como esperado.
  for (const suspeito of [null, undefined, "true", 1, {}, []]) {
    const r = await pedir({ papel: suspeito });
    assert.equal(r.status, 403, JSON.stringify(suspeito));
    assert.equal(r.buscou, false, JSON.stringify(suspeito));
  }
});

Deno.test("o portão usa o JWT de quem chamou, não a service role", async () => {
  // O erro que tornaria tudo acima decorativo: montar o cliente com a chave de
  // serviço faz `get_my_role()` responder pelo servidor, e aí a política libera
  // sempre, para qualquer um.
  await pedir({ papel: true });
  const [url, chave, opcoes] = ultimosArgs() as [string, string, Record<string, any>];
  assert.equal(url, "https://supabase.invalid");
  assert.equal(chave, "test-anon-key");
  assert.notEqual(chave, "test-service-role", "service role aqui anularia o portão");
  assert.equal(opcoes.global.headers.Authorization, JWT);
});
