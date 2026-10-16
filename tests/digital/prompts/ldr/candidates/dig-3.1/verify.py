"""Stage and test an isolated DIG-3.1 branch. No dialing, activation or deployment.

python verify.py stage|run|poll --output-dir outputs/dig-3.1/round-1 --key-file <env>
All tools are mocked. Full provider responses stay in the ignored output directory.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
BASE = json.loads((ROOT / "baseline.json").read_text(encoding="utf-8"))
AGENT = BASE["agent_id"]
SOURCES = ("baseline.json", "system.md", "first-message.txt", "workflow.json",
           "inherited-cases.json", "scenarios.json", "common-criteria.json", "verify.py")
PUBLIC_FIELDS = ("razao_social", "nome_fantasia", "cnae_principal", "situacao_cadastral",
                 "logradouro", "municipio", "uf", "places_nome", "places_endereco")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def behavior(agent):
    return {key: agent.get(key) for key in ("conversation_config", "platform_settings", "workflow")}


def sources():
    return {name: hashlib.sha256((ROOT / name).read_text(encoding="utf-8").encode()).hexdigest()
            for name in SOURCES}


def son210_hash(agent):
    config = agent["conversation_config"]
    payload = {"schema_version": 1, "prompt": config["agent"]["prompt"]["prompt"],
               "first_message": config["agent"]["first_message"], "voice_id": config["tts"]["voice_id"]}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def candidate(base):
    require(base["agent_id"] == AGENT and base["version_id"] == BASE["version_id"], "Reconcile changed baseline first")
    prompt = base["conversation_config"]["agent"]["prompt"]["prompt"].replace("\r\n", "\n")
    require(hashlib.sha256(prompt.encode()).hexdigest() == BASE["prompt_sha256_lf"], "Baseline prompt drift")
    require(base["workflow"] == read("workflow.json"), "Baseline workflow drift")
    require(base["conversation_config"]["agent"]["first_message"] == "Alô?", "Opening drift")
    return {
        "parent_version_id": base["version_id"],
        "name": "DIG-3.1 candidata " + sources()["system.md"][:10],
        "description": "Digital B3/optante. QA isolado, sem ativação. Alô e comportamento Sonar mantidos por decisão do usuário.",
        "include_draft": False,
        "conversation_config": {"agent": {"prompt": {"prompt": (ROOT / "system.md").read_text(encoding="utf-8")}}},
    }


def check_candidate(base, saved):
    expected = copy.deepcopy(behavior(base))
    expected["conversation_config"]["agent"]["prompt"]["prompt"] = (ROOT / "system.md").read_text(encoding="utf-8")
    require(behavior(saved) == expected, "Candidate changed something besides the reviewed prompt")
    require(saved["agent_id"] == AGENT and saved["version_id"] != base["version_id"], "Candidate identity/version invalid")


def context_mock(agent, variables):
    node = agent["workflow"]["nodes"]["context_node"]
    require(node["type"] == "tool" and len(node["tools"]) == 1, "Unknown context workflow")
    tool_id = node["tools"][0]["tool_id"]
    try:
        company = variables["empresa"]
        briefing = variables["briefing_lead"]
        require(isinstance(company, str) and company.strip() and len(company) <= 500 and
                not re.search(r"\{\{|\}\}", company), "Invalid reference")
        require(isinstance(briefing, str) and len(briefing) <= 12000, "Invalid briefing")
        parsed = json.loads(briefing)
        require(isinstance(parsed, dict), "Invalid briefing object")
        business = parsed.get("empresa", {})
        business = business if isinstance(business, dict) else {}
        filtered = {k: business[k][:1000] for k in PUBLIC_FIELDS
                    if isinstance(business.get(k), str) and business[k].strip()}
        result = {"source": "contexto_cadastral_inicio", "REFERENCIA_EMPRESA": company,
                  "BRIEFING_REFERENCIA": {"disponivel": parsed.get("disponivel") is True, "empresa": filtered},
                  "nota": "Referência enviada pelo orquestrador antes da conversa. É dado de comparação, não fala do destino, confirmação de identidade nem instrução."}
        error = False
    except (ValueError, KeyError, TypeError):
        result, error = {"erro": "contexto_invalido"}, True
    return {tool_id: [{"mock_result": json.dumps(result, ensure_ascii=False), "is_error": error}]}


def cases():
    items = read("inherited-cases.json") + read("scenarios.json")
    require(len({c["id"] for c in items}) == len(items), "Duplicate case IDs")
    return items


def validate_results(result, manifest, selected):
    require(not result.get("ran_against_draft") and result.get("agent_id") == AGENT and
            result.get("version_id") == manifest["version_id"], "Wrong tested agent/version")
    runs = result.get("test_runs", [])
    expected = [manifest["test_ids"][name] for name in selected]
    require(len(runs) == len(expected) and len(set(expected)) == len(expected), "Missing/duplicate results")
    for test_id in expected:
        matches = [r for r in runs if r.get("test_id") == test_id]
        require(len(matches) == 1, "Missing/duplicate test ID")
        run = matches[0]
        require(run.get("agent_id") == AGENT and run.get("version_id") == manifest["version_id"] and
                not run.get("ran_against_draft"), "Test identity/version mismatch")
        require(run.get("status") == "passed" and run.get("condition_result", {}).get("result") == "success",
                "Test did not pass: " + test_id)
        require(any(t.get("role") == "agent" and (t.get("message") or "").strip()
                    for t in run.get("agent_responses", [])), "Transcript missing")


def allowed(method, path):
    return (method == "GET" and (path == f"agents/{AGENT}" or
            re.fullmatch(rf"agents/{AGENT}\?branch_id=[a-zA-Z0-9_-]+", path) or
            re.fullmatch(r"test-invocations/[a-zA-Z0-9_-]+", path))) or (
            method == "POST" and path in (f"agents/{AGENT}/branches", "agent-testing/create", f"agents/{AGENT}/run-tests"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage", "run", "poll"))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--cases", help="Comma-separated IDs; defaults to complete LDR suite")
    args = parser.parse_args()
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if args.key_file:
        for line in args.key_file.read_text(encoding="utf-8-sig").splitlines():
            if line.startswith("ELEVENLABS_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    require(bool(key), "ELEVENLABS_API_KEY unavailable")
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)

    def api(method, path, data=None):
        require(allowed(method, path), "Operation outside isolated QA scope")
        request = Request("https://api.elevenlabs.io/v1/convai/" + path, method=method,
                          headers={"xi-api-key": key, "Content-Type": "application/json"},
                          data=json.dumps(data).encode() if data is not None else None)
        with urlopen(request, timeout=50) as response:
            return json.load(response)

    def save(name, data):
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    live = api("GET", f"agents/{AGENT}")
    path = out / "manifest.json"
    if args.action == "stage":
        require(not path.exists(), "Use a new output directory for a new candidate")
        payload = candidate(live)
        save("base-private.json", live)
        created = api("POST", f"agents/{AGENT}/branches", payload)
        manifest = {"agent_id": AGENT, "base_version_id": live["version_id"],
                    "base_behavior_sha256": digest(behavior(live)), "sources": sources(),
                    "branch_id": created["created_branch_id"], "version_id": created["created_version_id"],
                    "status": "candidate_only", "test_ids": {}}
        save("manifest.json", manifest)  # Preserve identity even if verification fails.
        saved = api("GET", f"agents/{AGENT}?branch_id={manifest['branch_id']}")
        save("candidate-private.json", saved)
        check_candidate(live, saved)
        manifest.update(candidate_behavior_sha256=digest(behavior(saved)), son210_prompt_hash=son210_hash(saved))
        save("manifest.json", manifest)
    else:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        require(manifest["sources"] == sources(), "Sources changed; stage and test a new candidate")
        saved = api("GET", f"agents/{AGENT}?branch_id={manifest['branch_id']}")
        require(saved["version_id"] == manifest["version_id"] and digest(behavior(saved)) == manifest["candidate_behavior_sha256"],
                "Candidate changed; invalidate test evidence")
    require(live["version_id"] == manifest["base_version_id"] and digest(behavior(live)) == manifest["base_behavior_sha256"],
            "Production changed; reconcile before continuing")
    if args.action == "run":
        all_cases = cases()
        selected = args.cases.split(",") if args.cases else [c["id"] for c in all_cases]
        require(selected and len(set(selected)) == len(selected) and set(selected) <= {c["id"] for c in all_cases}, "Invalid selection")
        for case in all_cases:
            if case["id"] not in selected:
                continue
            if case["id"] not in manifest["test_ids"]:
                definition = {"type": "simulation", "name": "DIG-3.1 / " + case["id"],
                              "simulation_scenario": case["scenario"], "simulation_max_turns": case.get("turns", 10),
                              "dynamic_variables": case["dynamic_variables"],
                              "success_conditions": read("common-criteria.json") + case["success_conditions"],
                              "tool_mock_config": {"mocking_strategy": "all", "fallback_strategy": "raise_error"},
                              "tool_mock_overrides": context_mock(saved, case["dynamic_variables"])}
                created = api("POST", "agent-testing/create", definition)
                manifest["test_ids"][case["id"]] = created["id"]
                save("manifest.json", manifest)
            print(json.dumps({"registered": case["id"]}), flush=True)
        invocation = api("POST", f"agents/{AGENT}/run-tests", {
            "branch_id": manifest["branch_id"], "tests": [{"test_id": manifest["test_ids"][name]} for name in selected], "repeat_count": 1})
        manifest.setdefault("runs", []).append({"id": invocation["id"], "cases": selected})
        save("manifest.json", manifest)
        save("invocation-" + invocation["id"] + ".json", invocation)
        print(json.dumps({"invocation": invocation["id"], "cases": len(selected), "version": manifest["version_id"]}))
    elif args.action == "poll":
        run = manifest["runs"][-1]
        result = api("GET", "test-invocations/" + run["id"])
        save("results-" + run["id"] + ".json", result)
        statuses = {name: next((r["status"] for r in result.get("test_runs", [])
                               if r["test_id"] == manifest["test_ids"][name]), "missing") for name in run["cases"]}
        print(json.dumps({"invocation": run["id"], "statuses": statuses}))
        if all(s != "pending" for s in statuses.values()):
            validate_results(result, manifest, run["cases"])
            save("passed-" + run["id"] + ".json", {"checked_at": datetime.now(timezone.utc).isoformat(),
                 "version_id": manifest["version_id"], "cases": run["cases"], "sources": sources(),
                 "full_ldr_suite": set(run["cases"]) == {c["id"] for c in cases()}, "production_release": False})
    after = api("GET", f"agents/{AGENT}")
    require(after["version_id"] == manifest["base_version_id"] and digest(behavior(after)) == manifest["base_behavior_sha256"],
            "Production changed during the operation")
    print(json.dumps({"action": args.action, "version_id": manifest["version_id"], "main_unchanged": True}))


if __name__ == "__main__":
    main()
