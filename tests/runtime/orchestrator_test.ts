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
  optout?: boolean; optoutError?: boolean; optoutBeforePost?: boolean;
  sonarPortao?: boolean; sonarPortaoError?: boolean; sonarPortaoBeforePost?: boolean;
  registroFalhaErro?: boolean;
  degrauEsgotado?: boolean; degrauError?: boolean;
};

async function scenario(options: Options, ids = ["phone-1"]) {
  const reads: ReturnType<typeof agent>[] = [];
  const payloads: Record<string, unknown>[] = [];
  const updates: Query[] = [];
  const falhasGravadas: Query[] = [];
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
        np_leads: { nome_exibicao: options.noCompany ? "" : "COMERCIO DE PECAS LTDA", cnpj: "12345678000195" },
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
    // SON-2.6 — registro da falha de disparo
    if (q.table === "np_ldr_disparos_falhos" && q.action === "insert") {
      order.push("falha_registrada"); falhasGravadas.push(q);
      return { data: null, error: options.registroFalhaErro ? { message: "tabela ausente" } : null };
    }
    throw new Error(`Unexpected query ${JSON.stringify(q)}`);
  }
  await withEdge("ldr-automatico-orquestrador", {
    db,
    rpc(name, args) {
      // SON-2.2: a janela (R3) virou consulta ao banco. A correcao da regra e
      // provada na suite SQL do repo nexilead; aqui ela so precisa liberar,
      // para os testes deste arquivo continuarem medindo o que medem.
      if (name === "np_fn_sonar_janela_discagem") {
        return { error: null, data: {
          pode: true, codigo: "dentro_da_janela", motivo: "dentro da janela (teste)",
          ddd: "11", offset_horas: -3, hora_local: "2026-09-30 10:00",
          dia_semana: 3, feriado: null,
        } };
      }
      if (name === "np_fn_pode_contatar") {
        assert.equal(args.p_e164, "+5500000000000");
        assert.equal(args.p_cnpj, "12345678000195");
        return { data: !(options.optout || (options.optoutBeforePost && reads.length > 0)), error: options.optoutError ? { message: "offline" } : null };
      }
      if (name === "np_fn_sonar_pode_discar") {
        assert.equal(args.p_cnpj, "12345678000195");
        assert.equal(args.p_agente, "ldr");
        return { data: !(options.sonarPortao || (options.sonarPortaoBeforePost && reads.length > 0)), error: options.sonarPortaoError ? { message: "offline" } : null };
      }
      // SON-4.4: teto de vazao diaria. O orquestrador le o degrau antes de cada
      // POST; sem este stub a leitura cai no catch-all abaixo, estoura, e o
      // portao (fail-closed) impede toda discagem — foi o que quebrou 11 testes
      // deste arquivo quando o portao entrou.
      if (name === "np_fn_sonar_degrau_atual") {
        if (options.degrauError) return { data: null, error: { message: "offline" } };
        // RETURNS TABLE chega como array pelo PostgREST.
        return { error: null, data: [{
          valor_dia: 50, desde: "2026-10-06T00:00:00Z", dias_no_degrau: 3,
          usado_hoje: options.degrauEsgotado ? 50 : 0,
          resta: options.degrauEsgotado ? 0 : 50,
        }] };
      }
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
  return { ...result, reads, payloads, updates, falhasGravadas, queries, order };
}

Deno.test("reputacao: pausa durante o lote impede o proximo POST e conserva pendentes", async () => {
  const r = await scenario({ pauseAfterFirst: true }, ["phone-1", "phone-2", "phone-3"]);
  assert.equal(r.payloads.length, 1);
  assert.equal(r.body.reputacaoBloqueada, true);
  assert.equal(r.status, 503);
  assert.deepEqual(r.body.pendentes, ["phone-2", "phone-3"]);
});

Deno.test("opt-out: bloqueio por telefone/CNPJ impede POST; falha do portão conserva pendentes", async () => {
  for (const options of [{ optout: true }, { optoutError: true }, { optoutBeforePost: true }]) {
    const r = await scenario(options);
    assert.equal(r.payloads.length, 0);
    if (options.optoutError) {
      assert.equal(r.status, 503);
      assert.equal(r.body.optoutIndisponivel, true);
      assert.deepEqual(r.body.pendentes, ["phone-1"]);
    } else {
      assert.equal(r.body.pulados[0].motivo, "opt_out");
    }
  }
});

Deno.test("SON-1.7: portao de 48h/teto bloqueia por CNPJ; falha do portão conserva pendentes", async () => {
  for (const options of [{ sonarPortao: true }, { sonarPortaoError: true }, { sonarPortaoBeforePost: true }]) {
    const r = await scenario(options);
    assert.equal(r.payloads.length, 0);
    if (options.sonarPortaoError) {
      assert.equal(r.status, 503);
      assert.equal(r.body.sonarPortaoIndisponivel, true);
      assert.deepEqual(r.body.pendentes, ["phone-1"]);
    } else {
      assert.equal(r.body.pulados[0].motivo, "sonar_portao_48h_teto");
    }
  }
});

Deno.test("SON-4.4: degrau esgotado para o lote e conserva pendentes", async () => {
  const r = await scenario({ degrauEsgotado: true });
  assert.equal(r.payloads.length, 0);
  assert.equal(r.body.degrauEsgotado, true);
  assert.equal(r.body.pulados[0].motivo, "degrau_esgotado");
  // Esgotar o teto nao e erro: e o freio funcionando. 503 faria o painel
  // tratar como incidente, e o lote voltaria como falha em vez de pendente.
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.pendentes, ["phone-1"]);
});

Deno.test("SON-4.4: teto indisponivel nao disca (fail-closed)", async () => {
  const r = await scenario({ degrauError: true });
  assert.equal(r.payloads.length, 0);
  assert.equal(r.body.degrauIndisponivel, true);
  assert.equal(r.status, 503);
  assert.deepEqual(r.body.pendentes, ["phone-1"]);
});

Deno.test("reputacao: erro do monitor impede qualquer discagem", async () => {
  const r = await scenario({ reputationError: true });
  assert.equal(r.payloads.length, 0);
  assert.equal(r.body.reputacaoBloqueada, true);
});

Deno.test("runtime: mesma leitura valida R5 e grava carimbo original por chamada", async () => {
  assert.equal(first.trim(), "Alô?");
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
    assert.deepEqual(snapshot.analysis_context, vars);
    assert.ok(!JSON.stringify(snapshot.analysis_context).includes('PRIVATE'));
    assert.equal(vars.empresa, "Comércio de Peças");
    assert.equal(JSON.parse(vars.briefing_lead).empresa.razao_social, "COMERCIO DE PECAS LTDA");
    assert.ok(!JSON.stringify(vars).includes("PRIVATE"));
    assert.equal(r.body.ligados[i].promptHash, expectedHash);
  }
  assert.notEqual(r.updates[0].values!.ia_prompt_hash, r.updates[1].values!.ia_prompt_hash);
});

Deno.test("runtime: ausência de cada elemento da política ativa impede POST e gravação", async () => {
  for (const marker of ["Tendência Energia", "assistente virtual", "confirmar se este telefone pertence à empresa de referência", "Falo com a {{empresa}}?", "Responsável por energia é informação OPCIONAL, somente depois da identidade confirmada"]) {
    const r = await scenario({ changeAgent: (live) => { live.conversation_config.agent.prompt.prompt = prompt.replaceAll(marker, ""); } }, ["phone-1", "phone-2"]);
    assert.equal(r.status, 503); assert.equal(r.body.ok, false);
    assert.equal(r.payloads.length, 0); assert.equal(r.updates.length, 0);
    assert.deepEqual(r.body.pendentes, ["phone-2"]); assert.deepEqual(r.pauses, []);
  }
});

Deno.test("runtime: cumprimento diferente ou nova instrução sem hash aprovado não discam", async () => {
  for (const changeAgent of [
    (live: ReturnType<typeof agent>) => { live.conversation_config.agent.first_message = "Alõ?"; },
    (live: ReturnType<typeof agent>) => { live.conversation_config.agent.first_message = "Olá, sou o Bruno"; },
    (live: ReturnType<typeof agent>) => { live.conversation_config.agent.prompt.prompt += "\nNão diga a identificação após Alô."; },
  ]) {
    const r = await scenario({ changeAgent });
    assert.equal(r.status, 503); assert.equal(r.payloads.length, 0); assert.equal(r.updates.length, 0);
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

Deno.test("SON-2.6: recusa do provedor vira linha em np_ldr_disparos_falhos", async () => {
  const r = await scenario({ postFailure: true });
  // a evidência não pode existir só na resposta HTTP — é isso que trava a 2.6
  assert.equal(r.falhasGravadas.length, 1);
  const v = r.falhasGravadas[0].values!;
  assert.equal(v.telefone_id, "phone-1");
  assert.equal(v.lead_id, "lead-1");
  assert.equal(v.http_status, 503);
  // resposta crua guardada inteira: é nela que o padrão de número inválido
  // deve aparecer, e ainda não sabemos qual campo importa
  assert.deepEqual(v.resposta, { success: false });
  // sem mensagem/sip na resposta do provedor, grava null — nunca inventa
  assert.equal(v.provedor_mensagem, null);
  assert.equal(v.sip_call_id, null);
});

Deno.test("SON-2.6: falhar ao REGISTRAR a falha não interrompe o lote", async () => {
  // anotar é best-effort: o lote tem que seguir para os outros telefones,
  // senão um problema de tabela viraria parada de operação
  const r = await scenario({ postFailure: true, registroFalhaErro: true }, ["phone-1", "phone-2"]);
  assert.equal(r.payloads.length, 2);
  assert.equal(r.falhasGravadas.length, 2);
  assert.equal(r.body.falhas.length, 2);
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
  assert.equal(vars.empresa, "Comércio de Peças");
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
