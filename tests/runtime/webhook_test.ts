import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { withEdge, unexpectedFetch, type Query } from "./harness.ts";

const agentId = "agent_3501m1c2yxmye1q99p9nh7r7ndkg";

Deno.test("reputacao: assinatura valida persiste origem antes da correlacao; falha pede reentrega", async () => {
  const data = { status: "done", metadata: { start_time_unix_secs: 1800000000, call_duration_secs: 6,
    phone_call: { direction: "outbound", agent_number: "+5511000000001", external_number: "+5522000000001" } } };
  for (const mode of ["ok", "unsigned", "offline"]) {
    let ingestions = 0, lookups = 0;
    await withEdge("ldr-automatico-webhook", {
      fetch: unexpectedFetch,
      rpc(name, args) {
        assert.equal(name, "np_fn_sonar_reputacao_registrar");
        assert.equal(args.p_origem, "+5511000000001");
        assert.equal(args.p_duracao, 6);
        ingestions++;
        return { data: {}, error: mode === "offline" ? { message: "offline" } : null };
      },
      db() { lookups++; return { data: null, error: null }; },
    }, async handle => {
      const response = await handle(signed(data, mode !== "unsigned"));
      assert.equal(response.status, mode === "ok" ? 200 : mode === "unsigned" ? 401 : 500);
      assert.equal(ingestions, mode === "unsigned" ? 0 : 1);
      // SON-2.11: sao 2 idas ao banco agora — a busca do telefone e a gravacao
      // da conversa. Ligacao sem telefone correlacionado (teste feito direto no
      // painel) tambem e guardada; antes era descartada.
      assert.equal(lookups, mode === "ok" ? 2 : 0);
    });
  }
});

function signed(data: Record<string, unknown>, valid = true) {
  const body = JSON.stringify({ type: "post_call_transcription", event_timestamp: 1800000000, data: {
    conversation_id: "conversation-1", agent_id: agentId,
    analysis: { data_collection_results: { resultado_validacao: { value: "confirmado" } } }, ...data,
  } });
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", valid ? "test-signing-key" : "wrong-key").update(`${ts}.${body}`).digest("hex");
  return new Request("https://edge.invalid", { method: "POST", body,
    headers: { "ElevenLabs-Signature": `t=${ts},v0=${signature}` } });
}

async function scenario(data: Record<string, unknown>, options: {
  existing?: number; fallback?: Record<string, unknown>; noApiKey?: boolean;
  saveConflict?: boolean; invalidSignature?: boolean; repeat?: boolean;
  conversaFalha?: boolean;
} = {}) {
  const queries: Query[] = [];
  const updates: Query[] = [];
  const conversas: Query[] = [];
  let saved = options.existing;
  let fetches = 0;
  const responses: Array<{ status: number; body: Record<string, any> }> = [];
  await withEdge("ldr-automatico-webhook", {
    noApiKey: options.noApiKey,
    db(q) {
      queries.push(q);
      if (q.table === "np_lead_telefones" && q.action === "select") {
        assert.deepEqual(q.filters, [["eq", "ia_conversation_id", "conversation-1"]]);
        return { error: null, data: { id: "phone-1", lead_id: "lead-1", e164: "+5511000000001", np_leads: { cnpj: "12345678000195" }, ia_agent_id: agentId,
          ia_prompt_hash: "a".repeat(64), ia_custo_valor: saved ?? null, ia_custo_unidade: saved === undefined ? null : "USD" } };
      }
      if (q.table === "np_lead_telefones" && q.action === "update") {
        updates.push(q);
        if (options.saveConflict) return { error: null, data: null };
        if (typeof q.values!.ia_custo_valor === "number") saved = q.values!.ia_custo_valor;
        return { error: null, data: { id: "phone-1" } };
      }
      if (q.table === "np_tags") return { error: null, data: { id: "tag-1" } };
      if (q.table === "np_lead_tags" && q.action === "upsert") return { error: null };
      if (q.table === "np_ldr_conversas") {
        conversas.push(q);
        return { error: options.conversaFalha ? { message: "banco fora" } : null };
      }
      throw new Error(`Unexpected query ${JSON.stringify(q)}`);
    },
    fetch: (async (input, init) => {
      if (!options.fallback) unexpectedFetch();
      fetches++;
      assert.equal(String(input), "https://api.elevenlabs.io/v1/convai/conversations/conversation-1");
      assert.equal((init?.headers as Record<string, string>)["xi-api-key"], "test-eleven-key");
      return Response.json(options.fallback);
    }) as typeof fetch,
  }, async (handle) => {
    for (let i = 0; i < (options.repeat ? 2 : 1); i++) {
      const response = await handle(signed(data, !options.invalidSignature));
      responses.push({ status: response.status, body: await response.json() });
    }
  });
  return { queries, updates, fetches, responses, saved, conversas };
}

Deno.test("custos: cost_fiat é USD, créditos e componentes não são somados", async () => {
  const r = await scenario({ metadata: { cost_fiat: 0.12, cost: 1500, charging: { llm_charge: 99, call_charge: 400 }, private: "EXCLUDE" } });
  assert.equal(r.responses[0].status, 200); assert.equal(r.fetches, 0);
  const values = r.updates[0].values!;
  assert.equal(values.ia_custo_valor, 0.12); assert.equal(values.ia_custo_unidade, "USD");
  assert.equal(values.ia_resultado, "confirmado");
  const details = values.ia_custo_detalhes as any;
  assert.equal(details.metadata.cost, 1500); assert.equal(details.metadata.charging.llm_charge, 99);
  assert.equal(details.origem, "post_call_transcription");
  assert.ok(!JSON.stringify(values).includes("EXCLUDE"));
  assert.ok(!Object.keys(values).some((key) => ["ia_prompt_hash", "ia_config_snapshot", "ia_voice_id", "ia_agent_id"].includes(key)));
  assert.deepEqual(r.updates[0].filters, [["eq", "id", "phone-1"], ["eq", "ia_conversation_id", "conversation-1"], ["is", "ia_custo_valor", null]]);
  assert.equal(r.responses[0].body.tagAplicada, true);
});

Deno.test("custos: zero explícito é apurado sem consulta", async () => {
  const r = await scenario({ metadata: { cost_fiat: 0 } });
  assert.equal(r.responses[0].status, 200); assert.equal(r.saved, 0); assert.equal(r.fetches, 0);
});

Deno.test("custos: ausente ou inválido fica pendente sem escrever zero/null", async () => {
  for (const value of [undefined, null, "0", -1, false]) {
    const r = await scenario({ metadata: { cost_fiat: value } }, { noApiKey: true });
    assert.equal(r.responses[0].status, 503); assert.equal(r.responses[0].body.vereditoGravado, true);
    assert.equal(r.responses[0].body.custoPendente, true); assert.equal(r.responses[0].body.tagAplicada, true);
    assert.ok(!("ia_custo_valor" in r.updates[0].values!));
    assert.ok(!("ia_custo_unidade" in r.updates[0].values!));
    assert.equal((r.updates[0].values!.ia_custo_detalhes as any).status, "pendente");
  }
});

Deno.test("custos: fallback consulta conversa finalizada com identidade correspondente", async () => {
  const r = await scenario({}, { fallback: { conversation_id: "conversation-1", agent_id: agentId, status: "done", metadata: { cost_fiat: 0.45 } } });
  assert.equal(r.responses[0].status, 200); assert.equal(r.saved, 0.45); assert.equal(r.fetches, 1);
  assert.equal((r.updates[0].values!.ia_custo_detalhes as any).origem, "conversation_get");
});

Deno.test("custos: fallback divergente ou ainda em andamento não atribui cobrança", async () => {
  for (const change of [{ agent_id: "other" }, { conversation_id: "other" }, { status: "processing" }]) {
    const r = await scenario({}, { fallback: { conversation_id: "conversation-1", agent_id: agentId, status: "done", metadata: { cost_fiat: 999 }, ...change } });
    assert.equal(r.responses[0].status, 503); assert.ok(!("ia_custo_valor" in r.updates[0].values!));
  }
});

Deno.test("custos: reentrega preserva primeira apuração e não acumula", async () => {
  const r = await scenario({ metadata: { cost_fiat: 0.12 } }, { repeat: true });
  assert.equal(r.saved, 0.12); assert.equal(r.responses[1].body.custoReutilizado, true);
  assert.ok(!Object.keys(r.updates[1].values!).some((key) => key.startsWith("ia_custo")));
  assert.equal(r.fetches, 0);
  const existing = await scenario({}, { existing: 0 });
  assert.equal(existing.responses[0].status, 200); assert.equal(existing.fetches, 0);
  assert.ok(!("ia_custo_valor" in existing.updates[0].values!));
});

Deno.test("custos: perda de correlação ou disputa de escrita exige reentrega", async () => {
  const r = await scenario({ metadata: { cost_fiat: 0.12 } }, { saveConflict: true });
  assert.equal(r.responses[0].status, 500); assert.ok(!r.queries.some((q) => q.table === "np_lead_tags"));
});

Deno.test("custos: outro agente e assinatura inválida não atualizam telefone", async () => {
  const other = await scenario({ agent_id: "other", metadata: { cost_fiat: 0.12 } });
  assert.equal(other.responses[0].status, 500); assert.equal(other.updates.length, 0);
  const invalid = await scenario({}, { invalidSignature: true });
  assert.equal(invalid.responses[0].status, 401); assert.equal(invalid.queries.length, 0); assert.equal(invalid.fetches, 0);
});

// ===========================================================================
// SON-2.11 — a conversa deixa de ser descartada
// ===========================================================================

const doisTurnos = [
  { role: "agent", message: "Oi, aqui é o Bruno da Tendência Energia.", time_in_call_secs: 0 },
  { role: "user",  message: "Pois não.",                                time_in_call_secs: 3 },
];

Deno.test('SON-6.2: webhook assinado persiste decisor ausente sem mudar validacao ou opt-out', async () => {
  const data={metadata:{cost_fiat:0.5},transcript:[{role:'user',message:'Sou da recepção. Carlos cuida disso, mas está ausente.'}],
    analysis:{data_collection_results:{resultado_validacao:{value:'CONFIRMADO'},redflag:{value:false},
      son62_interlocutor:{value:'INTERMEDIARIO'},son62_interlocutor_evidencia:{value:'Sou da recepção.'},
      son62_responsavel_ausente:{value:true},son62_ausencia_evidencia:{value:'Carlos cuida disso, mas está ausente.'},
      son62_nome_responsavel:{value:'Carlos'},son62_nome_evidencia:{value:'Carlos cuida disso, mas está ausente.'}}}};
  const r=await scenario(data,{repeat:true});
  assert.ok(r.responses.every(x=>x.status===200));
  assert.equal(r.updates[0].values!.ia_resultado,'confirmado');
  const p=(r.conversas[0].values!.metadados as Record<string,any>).porteiro;
  assert.equal(p.diagnostico,'decisor_ausente');assert.equal(p.nome_responsavel,'Carlos');
  assert.equal(r.conversas[1].values!.conversation_id,r.conversas[0].values!.conversation_id);
  const wrong=await scenario({...data,analysis:{data_collection_results:{...data.analysis.data_collection_results,resultado_validacao:{value:'NAO_CONFIRMADO'}}}});
  const w=(wrong.conversas[0].values!.metadados as Record<string,any>).porteiro;
  assert.equal(w.diagnostico,'numero_errado');assert.equal(w.nome_responsavel,null);
  const failed=await scenario(data,{conversaFalha:true});assert.equal(failed.responses[0].status,503);
  const unsigned=await scenario(data,{invalidSignature:true});assert.equal(unsigned.conversas.length,0);
});

Deno.test("SON-6.8: webhook guarda hash correlacionado, versao e medicao sem atribuir falha a interrupcao", async () => {
  const r = await scenario({status:"done",version_id:"historical_version_1",
    metadata:{cost_fiat:0.5},transcript:[{role:"agent",message:"Oi",interrupted:true,time_in_call_secs:0,
      conversation_turn_metrics:{metrics:{convai_ttf_audio_since_silence:{elapsed_time:0.234}}}}]});
  assert.equal(r.responses[0].status,200);
  const q=(r.conversas[0].values!.metadados as Record<string,any>).qualidade;
  assert.equal(q.prompt_hash,"a".repeat(64));
  assert.equal(q.prompt_hash_fonte,"carimbo_pre_disparo");
  assert.equal(q.provider_version_id,"historical_version_1");
  assert.equal(q.primeiro_audio_ms,234);assert.equal(q.interrupcoes,1);
  assert.equal(q.bargein_mal_resolvido_pct,undefined);
});

Deno.test("SON-2.11: a conversa é gravada com transcript, duração e correlação", async () => {
  const r = await scenario({
    status: "done",
    transcript: doisTurnos,
    metadata: { start_time_unix_secs: 1800000000, call_duration_secs: 42, cost_fiat: 0.5 },
  });

  assert.equal(r.conversas.length, 1, "uma gravação por entrega");
  const linha = r.conversas[0].values!;
  assert.equal(linha.conversation_id, "conversation-1");
  assert.equal(linha.telefone_id, "phone-1", "correlacionada ao telefone testado");
  assert.equal(linha.lead_id, "lead-1");
  assert.equal(linha.origem, "webhook");
  assert.equal(linha.resultado, "confirmado", "o veredito viaja junto");
  assert.equal(linha.duracao_seg, 42);
  assert.equal(linha.iniciada_em, new Date(1800000000 * 1000).toISOString());

  // `agent` vira `robo`, que é o vocabulário que a tela já usa.
  assert.deepEqual(linha.transcript, [
    { role: "robo",    mensagem: "Oi, aqui é o Bruno da Tendência Energia.", seg: 0 },
    { role: "empresa", mensagem: "Pois não.",                                seg: 3 },
  ]);

  // Com conteúdo, substitui: é o caso em que a reentrega traz a versão boa.
  assert.equal(r.conversas[0].options?.onConflict, "conversation_id");
  assert.equal(r.conversas[0].options?.ignoreDuplicates, false);
});

Deno.test("SON-2.11: reentrega sem transcript não pode apagar o que já foi guardado", async () => {
  // Payload sem transcript — acontece de verdade em reentrega. Um upsert cego
  // aqui zeraria uma conversa boa, que é exatamente o que a task existe para
  // impedir. A proteção é o ignoreDuplicates.
  const r = await scenario({
    status: "done",
    metadata: { start_time_unix_secs: 1800000000, call_duration_secs: 42, cost_fiat: 0.5 },
  });
  assert.deepEqual(r.conversas[0].values!.transcript, []);
  assert.equal(r.conversas[0].options?.ignoreDuplicates, true, "sem conteúdo, nunca sobrescreve");
});

Deno.test("SON-2.11: falha ao gravar a conversa pede reentrega SEM perder o veredito", async () => {
  const r = await scenario({
    status: "done",
    transcript: doisTurnos,
    metadata: { start_time_unix_secs: 1800000000, call_duration_secs: 42, cost_fiat: 0.5 },
  }, { conversaFalha: true });

  const resposta = r.responses[0];
  assert.equal(resposta.status, 503, "503 é o que faz a ElevenLabs reentregar");
  assert.equal(resposta.body.conversaGravada, false);
  assert.equal(resposta.body.vereditoGravado, true, "o veredito NÃO se perde junto");
  assert.equal(resposta.body.resultado, "confirmado");

  // A prova que importa: o UPDATE do veredito saiu antes, e saiu de verdade.
  assert.equal(r.updates.length, 1);
  assert.equal(r.updates[0].values!.ia_resultado, "confirmado");
});
