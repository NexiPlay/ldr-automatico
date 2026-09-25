import test from "node:test";
import assert from "node:assert/strict";
import { controls, assertNegativeResults } from "../scripts/son25-negative-control.mjs";
const mapping = Object.keys(controls).map((id, i) => ({ case: id, test_id: `test-${i}` }));
const failed = () => ({ agent_id: "bruno", ran_against_draft: true, test_runs: mapping.map(c => ({
  test_id: c.test_id, agent_id: "bruno", status: "failed", condition_result: { result: "failure" },
  agent_responses: [{ role: "agent", message: controls[c.case] }],
})) });

test("controle negativo: quatro violações avaliadas reprovam pelo gate comportamental real", () => {
  const proof = assertNegativeResults(failed(), mapping, "bruno");
  assert.equal(proof.release_blocked, true); assert.equal(proof.findings.length, 4);
  assert.match(proof.blocked_by, /sem sucesso comprovado/);
});
test("erro técnico, aprovação indevida, eco do usuário e resultado ausente não são prova negativa", () => {
  for (const mutate of [
    r => { r.test_runs[0].status = "error"; },
    r => { r.test_runs[0].condition_result.result = "unknown"; },
    r => { r.test_runs[0].status = "passed"; r.test_runs[0].condition_result.result = "success"; },
    r => { r.test_runs[0].agent_responses[0].role = "user"; },
    r => { r.test_runs[0].agent_responses[0].message = "Não posso informar o preço."; },
    r => { r.test_runs.pop(); },
    r => { r.test_runs[1].test_id = r.test_runs[0].test_id; },
  ]) { const result = failed(); mutate(result); assert.throws(() => assertNegativeResults(result, mapping, "bruno")); }
});
