"""Publicação da integração Karla Digital, condicionada à suíte conjunta DIG-3.3.

Exige diretório novo em outputs/dig-3.2, fontes commitadas, base de produção
conferida, testes locais e resultado remoto recente. Não altera secrets, agente
principal, 3CX, orçamento, degrau nem faz chamadas. A migration é aplicada
explicitamente antes, após seu teste transacional.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "wbagoinuxgvntvbbnmab"
BASE = {'karla-dialer': {'version': 39, 'verify_jwt': True, 'ezbr_sha256': '4d30986e1fdda6d729c4c7955c9f8ad40a9ae5a037b10a602d7f33786b9bf703'}, 'karla-sdr-webhook': {'version': 28, 'verify_jwt': False, 'ezbr_sha256': 'b155fd62f06b2906b0cdd359e9cfa620a6bae368315f535fc3f444be58c1e7bd'}}
FILES = ["karla-dialer/index.ts", "karla-dialer/digital.ts", "karla-dialer/digital-approval.json", "karla-dialer/digital-gasto.ts",
         "karla-sdr-webhook/index.ts", "_shared/digital-gasto.ts", "_shared/sonar-reputacao.ts", "_shared/sonar-followup.ts"]
spec = importlib.util.spec_from_file_location("digital_release", ROOT / "backend/digital_release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-dir", type=Path, required=True)
    parser.add_argument("--suite-dir", type=Path, required=True)
    parser.add_argument("--supabase-cli", required=True)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--deploy", action="store_true")
    args = parser.parse_args()
    stage = args.stage_dir.resolve()
    release.require(stage.is_relative_to(ROOT / "outputs/dig-3.2") and not stage.exists(),
                    "Use um diretório NOVO dentro de outputs/dig-3.2")

    def run(command, cwd=ROOT):
        result = subprocess.run([str(x) for x in command], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
        if result.returncode:
            # Não repetir arquivos de configuração/headers/segredos no erro.
            raise RuntimeError(f"Comando falhou ({result.returncode}): {Path(str(command[0])).name}; " + result.stderr[-1800:])
        return result.stdout

    git = ["git", "-c", f"safe.directory={ROOT.as_posix()}"]
    tracked = run(git + ["status", "--porcelain", "--untracked-files=normal"])
    release.require(not tracked.strip(), "Comite/revise as alterações antes da publicação")
    commit = run(git + ["rev-parse", "HEAD"]).strip()
    release.check_report(release.read(args.suite_dir / "report-private.json"), release.read(release.SPEC), release.source_hashes(), release.definitions())
    verify = [sys.executable, ROOT / "backend/digital_release.py", "verify", "--output-dir", args.suite_dir]
    if args.key_file:
        verify += ["--key-file", args.key_file]
    run(verify)
    cli = [args.supabase_cli]
    before = json.loads(run(cli + ["functions", "list", "--project-ref", PROJECT, "--output", "json"]))
    for name, expected in BASE.items():
        live = next(f for f in before if f["name"] == name)
        release.require(all(live.get(k) == v for k, v in expected.items()), "Produção mudou; reconciliar " + name)
    run(["node", "--test", "backend/edge-functions/karla-dialer/digital.test.mjs",
         "prompts/karla-sdr/candidates/dig-3.2/collection-checks.test.mjs"])
    run([sys.executable, "-m", "unittest", "discover", "-s", "backend/tests", "-p", "test_digital_release.py"])
    run(["node", "--test", "backend/tests/digital/gasto.test.mjs", "backend/tests/digital/contexto.test.mjs"])
    stage.mkdir(parents=True)
    for name in FILES:
        dest = stage / "supabase/functions" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "backend/edge-functions" / name, dest)
    (stage / "supabase/config.toml").write_text(
        f'project_id = "{PROJECT}"\n[functions.karla-dialer]\nverify_jwt = true\n'
        '[functions.karla-sdr-webhook]\nverify_jwt = false\n', encoding="utf-8")
    receipt = {"status": "prepared", "commit": commit, "project": PROJECT, "before": {
        f["name"]: {k:f.get(k) for k in ("version", "verify_jwt", "ezbr_sha256")} for f in before if f["name"] in BASE},
        "source_sha256_lf": {name: release.file_sha(stage / "supabase/functions" / name) for name in FILES},
        "joint_suite": str(args.suite_dir), "sources": release.source_hashes()}
    release.save(stage / "deployment.json", receipt)
    if args.deploy:
        schema_check = stage / "schema-check.sql"
        schema_check.write_text("select to_regclass('public.np_digital_contextos') is not null as context_table, "
            "has_function_privilege('service_role','public.np_fn_digital_contexto(uuid)','EXECUTE') as server_access, "
            "not has_function_privilege('authenticated','public.np_fn_digital_contexto(uuid)','EXECUTE') as no_browser_access;\n", encoding="utf-8")
        schema = json.loads(run(cli + ["db", "query", "--linked", "--project-ref", PROJECT,
                                      "--output", "json", "--file", schema_check]))
        release.require(schema["rows"] == [{"context_table": True, "server_access": True, "no_browser_access": True}],
                        "Migration/contexto seguro ainda não publicado")
        # Última validação ocorre no caminho que efetivamente chama o deploy.
        run(verify)
        run(cli + ["functions", "deploy", *BASE, "--project-ref", PROJECT, "--use-api", "--jobs", "1"], cwd=stage)
        receipt["status"] = "deployed_verifying"
        release.save(stage / "deployment.json", receipt)
        after = json.loads(run(cli + ["functions", "list", "--project-ref", PROJECT, "--output", "json"]))
        receipt["after"] = {f["name"]: {k:f.get(k) for k in ("version", "verify_jwt", "ezbr_sha256")} for f in after if f["name"] in BASE}
        readback = stage / "readback"
        readback.mkdir()
        for name, expected in BASE.items():
            live = receipt["after"][name]
            release.require(live["version"] > expected["version"] and live["verify_jwt"] == expected["verify_jwt"],
                            "Versão/autenticação publicada diverge: " + name)
            run(cli + ["functions", "download", name, "--project-ref", PROJECT, "--use-api"], cwd=readback)
        for name, expected in receipt["source_sha256_lf"].items():
            release.require(release.file_sha(readback / "supabase/functions" / name) == expected,
                            "Fonte publicada difere: " + name)
        run(verify)
        receipt["status"] = "published_verified"
        release.save(stage / "deployment.json", receipt)
    print(json.dumps({"status": receipt["status"], "commit": commit, "functions": receipt.get("after", receipt["before"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
