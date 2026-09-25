import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { withEdge, type Query, type Result } from "./harness.ts";
import approval from "../../backend/edge-functions/_shared/ldr-approval.json" with { type: "json" };

const prompt = await Deno.readTextFile(new URL("../../prompts/bruno/system.md", import.meta.url));
const first = await Deno.readTextFile(new URL("../../prompts/bruno/first-message.txt", import.meta.url));
function agent(voice = "voice-test") {
  return {
    agent_id: approval.agent_id,
    conversation_config: {
      agent: { language: "pt", first_message: first, prompt: { prompt, llm: "llm-test", tools: [{ secret: "NEVER_SNAPSHOT" }] } },
      tts: { voice_id: voice, model_id: "tts-test" },
    },
    private_config: "NEVER_SNAPSHOT",
  };
}

type Options = {
  schemaError?: boolean; enrichmentError?: boolean; saveError?: boolean;
  noCompany?: boolean; noEnrichment?: boolean; alreadyCalled?: boolean;
  getFailure?: number; postFailure?: boolean; postThrow?: boolean;
  changeAgent?: (value: ReturnType<typeof agent>, index: number) => void;
  reputationError?: boolean; pauseAfterFirst?: boolean;
};

async function scenario(options: Options, ids = ["phone-1"]) {
  const reads: ReturnType<typeof agent>[] = [];
  const payloads: Record<string, unknown>[] = [];
  const updates: Query[] = [];
  const queries: Query[] = [];
  const order: string[] = [];
  let result!: { body: Record<string, any>; status: number; pauses: number[] };
  function db(q: Query): Result {
    queries.push(q);
    if (q.table === "np_lead_telefones" && q.limit === 0) {
      order.push("schema"); return { data: [], error: options.schemaError ? { message: "missing column" } : null };
    }
    if (q.table === "np_lead_telefones" && q.action === "select") {
      order.push("phone");
      return { error: null, data: {
        id: q.filters[0][2], lead_id: "lead-1", e164: "+5500000000000", ia_tentativas: 2,
        ia_conversation_id: options.alreadyCalled ? "existing" : null,
        np_leads: { nome_exibicao: options.noCompany ? "" : "COMERCIO DE PECAS LTDA" },
      } };
    }
    if (q.table === "np_lead_enriquecimento") {
      order.push("briefing");
      return { error: options.enrichmentError ? { message: "query failed" } : null,
        data: options.noEnrichment || options.noCompany ? null : {
          razao_social: "COMERCIO DE PECAS LTDA", logradouro: "Rua Um", socios: "PRIVATE", ia_decisores: "PRIVATE", preco: "PRIVATE",
        } };
    }
    if (q.table === "np_lead_telefones" && q.action === "update") {
      order.push("save"); updates.push(q);
      return { data: options.saveError ? null : { id: q.filters[0][2] }, error: options.saveError ? { message: "db offline" } : null };
    }
    throw new Error(`Unexpected query ${JSON.stringify(q)}`);
  }
  await withEdge("ldr-automatico-orquestrador", {
    db,
    rpc(name, args) {
      assert.equal(name, "np_fn_sonar_reputacao_portao");
      assert.equal(args.p_origem, "+5511000000010");
      return { error: options.reputationError ? { message: "offline" } : null,
        data: { permitido: !(options.pauseAfterFirst && payloads.length > 0), motivo_bloqueio: "Parada manual" } };
    },
    fetch: (async (input, init) => {
      if (String(input).includes("/phone-numbers/")) {
        return Response.json({ phone_number_id: "test-phone", phone_number: "+5511000000010" });
      }
      if (String(input).includes("/agents/")) {
        order.push("get");
        const live = agent(`voice-${reads.length + 1}`);
        options.changeAgent?.(live, reads.length);
        reads.push(structuredClone(live));
        return options.getFailure ? new Response("", { status: options.getFailure }) : Response.json(live);
      }
      assert.ok(String(input).endsWith("/sip-trunk/outbound-call"));
      assert.equal(init?.method, "POST");
      order.push("post"); payloads.push(JSON.parse(String(init?.body)));
      if (options.postThrow) throw new Error("ambiguous transport failure");
      if (options.postFailure) return Response.json({ success: false }, { status: 503 });
      return Response.json({ success: true, conversation_id: `conversation-${payloads.length}` });
    }) as typeof fetch,
  }, async (handle, pauses) => {
    const response = await handle(new Request("https://edge.invalid", { method: "POST", body: JSON.stringify({ telefone_ids: ids }) }));
    result = { body: await response.json(), status: response.status, pauses: [...pauses] };
  });
  return { ...result, reads, payloads, updates, queries, order };
}

Deno.test("reputacao: pausa durante o lote impede o proximo POST e conserva pendentes", async () => {
  const r = await scenario({ pauseAfterFirst: true }, ["phone-1", "phone-2", "phone-3"]);
  assert.equal(r.payloads.length, 1);
  assert.equal(r.body.reputacaoBloqueada, true);
  assert.equal(r.status, 503);
  assert.deepEqual(r.body.pendentes, ["phone-2", "phone-3"]);
});

Deno.test("reputacao: erro do monitor impede qualquer discagem", async () => {
  const r = await scenario({ reputationError: true });
  assert.equal(r.payloads.length, 0);
  assert.equal(r.body.reputacaoBloqueada, true);
});

Deno.test("runtime: mesma leitura valida R5 e grava carimbo original por chamada", async () => {
  const r = await scenario({}, ["phone-1", "phone-2"]);
  assert.equal(r.body.ok, true);
  assert.equal(r.reads.length, 2); assert.equal(r.payloads.length, 2);
  assert.deepEqual(r.order, ["schema", "phone", "briefing", "get", "post", "save", "phone", "briefing", "get", "post", "save"]);
  assert.deepEqual(r.pauses, [4000]);
  for (let i = 0; i < 2; i++) {
    const saved = r.updates[i].values!;
    const snapshot = saved.ia_config_snapshot as Record<string, unknown>;
    const expectedHash = createHash("sha256").update(JSON.stringify({
      schema_version: 1, prompt, first_message: first, voice_id: `voice-${i + 1}`,
    })).digest("hex");
    assert.equal(saved.ia_prompt_hash, expectedHash);
    assert.notEqual(saved.ia_prompt_hash, approval.prompt_sha256);
    assert.equal(saved.ia_voice_id, `voice-${i + 1}`);
    assert.equal(saved.ia_llm_model, "llm-test"); assert.equal(saved.ia_tts_model, "tts-test");
    assert.equal(saved.ia_agent_id, approval.agent_id); assert.equal(saved.ia_tentativas, 3);
    assert.equal(saved.ia_conversation_id, `conversation-${i + 1}`);
    assert.ok(Date.parse(String(saved.ia_config_lida_em)) <= Date.parse(String(saved.ia_disparado_em)));
    assert.equal(snapshot.prompt, prompt); assert.equal(snapshot.first_message, first);
    assert.ok(!JSON.stringify(snapshot).includes("NEVER_SNAPSHOT"));
    assert.ok(!Object.keys(saved).some((key) => key.startsWith("ia_custo")));
    const vars = (r.payloads[i].conversation_initiation_client_data as any).dynamic_variables;
    assert.equal(vars.empresa, "Comércio de Peças LTDA");
    assert.equal(JSON.parse(vars.briefing_lead).empresa.razao_social, "COMERCIO DE PECAS LTDA");
    assert.ok(!JSON.stringify(vars).includes("PRIVATE"));
    assert.equal(r.body.ligados[i].promptHash, expectedHash);
  }
  assert.notEqual(r.updates[0].values!.ia_prompt_hash, r.updates[1].values!.ia_prompt_hash);
});

Deno.test("runtime: ausência de cada elemento R5 impede POST e gravação", async () => {
  for (const marker of ["Tendência Energia", "assistente virtual", "Esta ligação está sendo gravada", "confirmar a empresa deste telefone e saber quem cuida de energia"]) {
    const r = await scenario({ changeAgent: (live) => { live.conversation_config.agent.first_message = first.replace(marker, ""); } }, ["phone-1", "phone-2"]);
    assert.equal(r.status, 503); assert.equal(r.body.ok, false);
    assert.equal(r.payloads.length, 0); assert.equal(r.updates.length, 0);
    assert.deepEqual(r.body.pendentes, ["phone-2"]); assert.deepEqual(r.pauses, []);
  }
});

Deno.test("runtime: edição no painel interrompe lote sem apagar carimbo anterior", async () => {
  const r = await scenario({ changeAgent: (live, i) => { if (i) live.conversation_config.agent.prompt.prompt += "\nOutro prompt"; } }, ["phone-1", "phone-2", "phone-3"]);
  assert.equal(r.status, 503); assert.equal(r.reads.length, 2); assert.equal(r.payloads.length, 1);
  assert.equal(r.updates.length, 1); assert.equal(r.body.ligados.length, 1);
  assert.equal(r.body.processados, 2); assert.deepEqual(r.body.pendentes, ["phone-3"]);
});

Deno.test("runtime: falha ao salvar conserva dados de recuperação e não redisca", async () => {
  const r = await scenario({ saveError: true }, ["phone-1", "phone-2"]);
  assert.equal(r.body.ok, false); assert.equal(r.payloads.length, 1);
  assert.deepEqual(r.body.falhas[0].dadosParaRecuperacao, r.updates[0].values);
  assert.deepEqual(r.body.pendentes, ["phone-2"]);
});

Deno.test("runtime: erro HTTP de discagem mantém pausa e não grava carimbo de chamada inexistente", async () => {
  const r = await scenario({ postFailure: true }, ["phone-1", "phone-2"]);
  assert.equal(r.payloads.length, 2); assert.equal(r.updates.length, 0);
  assert.deepEqual(r.pauses, [4000]); assert.equal(r.body.ok, false);
});

Deno.test("runtime: transporte ambíguo não repete o POST", async () => {
  const r = await scenario({ postThrow: true });
  assert.equal(r.payloads.length, 1); assert.equal(r.updates.length, 0); assert.equal(r.body.ok, false);
});

Deno.test("runtime: schema/carimbo/briefing inválidos falham antes de qualquer POST", async () => {
  for (const options of [
    { schemaError: true }, { enrichmentError: true }, { getFailure: 503 },
    { changeAgent: (live: ReturnType<typeof agent>) => { live.conversation_config.tts.voice_id = ""; } },
  ]) {
    const r = await scenario(options);
    assert.equal(r.payloads.length, 0); assert.equal(r.updates.length, 0); assert.equal(r.body.ok, false);
  }
});

Deno.test("runtime: sem enriquecimento usa referência normalizada; sem referência não disca", async () => {
  const r = await scenario({ noEnrichment: true });
  const vars = (r.payloads[0].conversation_initiation_client_data as any).dynamic_variables;
  assert.equal(vars.empresa, "Comércio de Peças LTDA");
  assert.equal(JSON.parse(vars.briefing_lead).disponivel, false);
  const missing = await scenario({ noCompany: true });
  assert.equal(missing.payloads.length, 0); assert.equal(missing.reads.length, 0);
  assert.equal(missing.body.pulados[0].motivo, "empresa_de_referencia_ausente");
});

Deno.test("runtime: telefone já discado não é lido do ElevenLabs nem recebe novo carimbo", async () => {
  const r = await scenario({ alreadyCalled: true });
  assert.equal(r.reads.length, 0); assert.equal(r.payloads.length, 0); assert.equal(r.updates.length, 0);
  assert.equal(r.body.pulados[0].motivo, "ja_tinha_conversation_id");
});
