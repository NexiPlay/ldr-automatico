import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { extrairRedflag } from "../../backend/edge-functions/_shared/ldr-optout.ts";
import { withEdge, unexpectedFetch, type Query } from "./harness.ts";

const agentId = "agent_3501m1c2yxmye1q99p9nh7r7ndkg";
function payload(redflag: unknown, validSignature = true) {
  const raw = JSON.stringify({ type: "post_call_transcription", event_timestamp: 1800000000,
    data: { conversation_id: "conversation-redflag", agent_id: agentId,
      metadata: { cost_fiat: 0.12 },
      analysis: { data_collection_results: { resultado_validacao: { value: "confirmado" }, redflag } } } });
  const t = String(Math.floor(Date.now()/1000));
  const sign = createHmac("sha256", validSignature ? "test-signing-key" : "wrong").update(`${t}.${raw}`).digest("hex");
  return new Request("https://edge.invalid", { method: "POST", body: raw, headers: { "ElevenLabs-Signature": `t=${t},v0=${sign}` } });
}

Deno.test("redflag: boolean/object/string canônicos; false não vira true e ausência não vira false", () => {
  for (const value of [true, { value: true }, { value: "true" }]) assert.equal(extrairRedflag({ data_collection_results: { redflag: value } }), true);
  for (const value of [false, { value: false }, { value: "false" }]) assert.equal(extrairRedflag({ data_collection_results: { redflag: value } }), false);
  assert.equal(extrairRedflag({}), null);
  for (const value of [1, "sim", [], { value: "unknown" }]) assert.throws(() => extrairRedflag({ data_collection_results: { redflag: value } }));
});

async function run(values: unknown[], options: { failure?: string; missingPhone?: boolean; badSignature?: boolean; } = {}) {
  const records = new Map<string, unknown>();
  const calls: Array<{name:string;args:Record<string, unknown>}> = [];
  const writes: Query[] = [];
  const responses: Array<{status:number;body:any}> = [];
  await withEdge("ldr-automatico-webhook", {
    fetch: unexpectedFetch,
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "np_fn_opt_out_registrar") {
        assert.ok(!(args.p_e164 && args.p_cnpj), "Uma chave por chamada do serviço SON-1.4");
        assert.equal(args.p_fonte, "verbal_chamada");
        assert.equal(args.p_pedido_em, "2027-01-15T08:00:00.000Z");
        const key = String(args.p_e164 ?? args.p_cnpj);
        if (options.failure === key) return { data:null,error:{message:"offline"} };
        records.set(key, args);
        return { data:"optout-id",error:null };
      }
      assert.equal(name, "np_fn_pode_contatar");
      return { data: !(records.has(String(args.p_e164)) || records.has(String(args.p_cnpj))), error:null };
    },
    db(q) {
      if (q.table === "np_lead_telefones" && q.action === "select") return { data:options.missingPhone ? null : {
        id:"phone-1", lead_id:"lead-1", e164:"+5511000000001", ia_agent_id:agentId,
        ia_custo_valor:0.12, ia_custo_unidade:"USD", np_leads:{cnpj:"12345678000195",origem:"bdgd"},
      },error:null };
      if (q.table === "np_lead_telefones" && q.action === "update") {
        writes.push(q); return { data:{id:"phone-1"},error:null };
      }
      if (q.table === "np_tags") return { data:{id:"qualificado"},error:null };
      if (q.table === "np_lead_tags") { writes.push(q); return { error:null }; }
      throw new Error(`Unexpected query ${JSON.stringify(q)}`);
    },
  }, async handle => {
    for (const value of values) {
      const response = await handle(payload(value, !options.badSignature));
      responses.push({status:response.status,body:await response.json()});
    }
  });
  return { records,calls,writes,responses };
}

Deno.test("redflag true: duas chaves antes do veredito, preserva custo/resultado e retira liberação", async () => {
  const r = await run([{value:true}]);
  assert.equal(r.responses[0].status,200);
  assert.equal(r.responses[0].body.optoutRegistrado,true);
  assert.equal(r.responses[0].body.resultado,"confirmado");
  assert.equal(r.responses[0].body.tagAplicada,false);
  assert.equal(r.records.size,2);
  assert.equal(r.writes[0].values?.ia_resultado,"confirmado");
  assert.equal(r.writes[1].action,"delete");
  assert.deepEqual(r.writes[1].filters,[["eq","lead_id","lead-1"],["eq","tag_id","qualificado"]]);
});

Deno.test("redflag: reentrega não duplica chaves e false posterior não remove bloqueio", async () => {
  const r = await run([true,true,false]);
  assert.equal(r.records.size,2);
  assert.ok(r.responses.every(x=>x.status===200 && !x.body.contatoPermitido && !x.body.tagAplicada));
  assert.equal(r.calls.filter(x=>x.name==="np_fn_opt_out_registrar").length,4);
  assert.ok(!r.writes.some(x=>x.action==="upsert"));
});

Deno.test("redflag false/ausente: resultados normais, sem inserir opt-out", async () => {
  for (const value of [false,{value:"false"},undefined]) {
    const r=await run([value]);
    assert.equal(r.responses[0].status,200);
    assert.equal(r.records.size,0);
    assert.equal(r.responses[0].body.tagAplicada,true);
  }
});

Deno.test("redflag: erro de persistência ou correlação exige reentrega e não libera lead", async () => {
  for (const options of [{failure:"+5511000000001"},{failure:"12345678000195"},{missingPhone:true}]) {
    const r=await run([true],options);
    assert.equal(r.responses[0].status,500);
    assert.ok(!r.writes.some(x=>x.action==="upsert"));
  }
  const unsigned=await run([true],{badSignature:true});
  assert.equal(unsigned.responses[0].status,401);
  assert.equal(unsigned.calls.length,0);
});
