import test from "node:test";
import assert from "node:assert/strict";
import { checkLocal, releaseGate, assertTestResults } from "../scripts/ldr-release.mjs";
import approval from "../backend/edge-functions/_shared/ldr-approval.json" with { type: "json" };
import cases from "./adversarial/cases.json" with { type: "json" };

const agentId = approval.agent_id;
const successful = (ids) => ({ id: "invocation", agent_id: agentId, version_id: "v1", ran_against_draft: false, test_runs: ids.map((test_id) => ({
  test_id, agent_id: agentId, version_id: "v1", status: "passed", condition_result: { result: "success" },
  agent_responses: [{ role: "agent", message: "Sou Bruno, assistente virtual." }],
})) });

test("suíte exige todos os resultados e evidência de fala do agente", () => {
  assertTestResults(successful(["a", "b"]), ["a", "b"], agentId, "v1");
  for (const mutate of [
    (r) => { r.test_runs.pop(); },
    (r) => { r.test_runs[1].test_id = "a"; },
    (r) => { r.test_runs[0].status = "failed"; },
    (r) => { r.test_runs[0].condition_result.result = "unknown"; },
    (r) => { r.test_runs[0].agent_responses = []; },
    (r) => { r.test_runs[0].agent_id = "karla"; },
    (r) => { r.ran_against_draft = true; },
    (r) => { r.version_id = "v2"; },
  ]) {
    const value = successful(["a", "b"]); mutate(value);
    assert.throws(() => assertTestResults(value, ["a", "b"], agentId, "v1"));
  }
});

async function fixture({ badPrompt = false, failCase = false, drift = false } = {}) {
  const { prompt, firstMessage } = await checkLocal();
  const requests = []; const ids = []; let reads = 0;
  const fetchImpl = async (url, options) => {
    requests.push(url);
    if (url.endsWith(`/agents/${agentId}`)) {
      reads++;
      return Response.json({ agent_id: agentId, version_id: "v1", conversation_config: { agent: {
        prompt: { prompt: badPrompt ? "Sem identificação" : prompt, llm: drift && reads > 1 ? "changed" : "model" }, first_message: firstMessage,
      } } });
    }
    if (url.endsWith("agent-testing/create")) {
      const body = JSON.parse(options.body);
      assert.equal(body.tool_mock_config.mocking_strategy, "all");
      assert.equal(body.tool_mock_config.fallback_strategy, "raise_error");
      assert.ok(body.success_conditions.length >= 5);
      assert.ok(body.dynamic_variables.briefing_lead);
      ids.push(`test-${ids.length}`); return Response.json({ id: ids.at(-1) });
    }
    if (url.endsWith("/run-tests")) {
      assert.deepEqual(JSON.parse(options.body).tests.map((v) => v.test_id), ids);
      assert.equal(JSON.parse(options.body).agent_config_override, undefined);
      const result = successful(ids); result.test_runs.forEach((run) => { run.status = "pending"; });
      return Response.json(result);
    }
    if (url.endsWith("test-invocations/invocation")) {
      const result = successful(ids);
      if (failCase) result.test_runs.at(-1).status = "failed";
      return Response.json(result);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return { requests, run: () => releaseGate({ env: { ELEVENLABS_API_KEY: "fake", ELEVENLABS_AGENT_ID: agentId }, fetchImpl, sleep: async () => {}, saveReport: false }) };
}

test("release verifica remoto, executa todos os ataques e reconsulta após a suíte", async () => {
  const f = await fixture(); const result = await f.run();
  assert.equal(result.cases, cases.length);
  assert.equal(f.requests.filter((u) => u.endsWith(`/agents/${agentId}`)).length, 2);
});
test("R5 remoto inválido impede até o início dos testes pagos", async () => {
  const f = await fixture({ badPrompt: true });
  await assert.rejects(f.run(), /R5/); assert.equal(f.requests.length, 1);
});
test("falha adversarial bloqueia release", async () => {
  const f = await fixture({ failCase: true }); await assert.rejects(f.run(), /sem sucesso/);
});
test("edição de modelo durante suíte bloqueia release", async () => {
  const f = await fixture({ drift: true }); await assert.rejects(f.run(), /mudou/);
});
