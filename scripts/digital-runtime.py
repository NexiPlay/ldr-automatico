"""Check the reviewed live baseline and read back every deployed dependency."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'wbagoinuxgvntvbbnmab'
BASELINE = {
    'ldr-automatico-orquestrador': (50, True, '4a3465f7009d38dc46ea9b23ec6ed2624649a80b412ec5379a27390c0660cebc'),
    'ldr-automatico-webhook': (42, False, 'd158058366734e829443f01bf7079873ed2b80b406355259c6f6f560e76ec133'),
    'karla-dialer': (39, True, '4d30986e1fdda6d729c4c7955c9f8ad40a9ae5a037b10a602d7f33786b9bf703'),
}


def sha(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def dependencies(path, base, found=None):
    found = set() if found is None else found
    path = path.resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        raise ValueError('Missing/outside dependency: ' + str(path))
    if path in found: return found
    found.add(path)
    if path.suffix in ('.ts', '.js', '.mjs'):
        for relative in re.findall(r'''(?:from\s*|import\s*)['"](\.[^'"]+)['"]''', path.read_text(encoding='utf-8')):
            dependencies(path.parent / relative, base, found)
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['before', 'after'])
    parser.add_argument('--cli', default='supabase')
    parser.add_argument('--stage', type=Path, default=ROOT / '.release')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'artifacts/digital-runtime')
    args = parser.parse_args()
    def cli(*params):
        return subprocess.check_output([args.cli, *map(str, params)], text=True, encoding='utf-8')
    live = {f['name']: f for f in json.loads(cli('functions', 'list', '--project-ref', PROJECT, '--output', 'json'))}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    receipt = {'checked_at': datetime.now(timezone.utc).isoformat(), 'action': args.action, 'functions': {}}
    stage = (args.stage / 'supabase/functions').resolve()
    for name, (version, jwt, digest) in BASELINE.items():
        item = live[name]
        if item['verify_jwt'] != jwt: raise ValueError('Authentication changed: ' + name)
        if args.action == 'before':
            if item['version'] != version or item['ezbr_sha256'] != digest:
                raise ValueError('Live baseline advanced; reconcile before deploying: ' + name)
            dependencies(stage / name / 'index.ts', stage)
        else:
            if item['version'] <= version: raise ValueError('Deployment missing: ' + name)
            readback = args.output_dir / ('readback-' + name)
            readback.mkdir(exist_ok=False)
            (readback / 'supabase').mkdir()
            (readback / 'supabase/config.toml').write_text(f'project_id = "{PROJECT}"\n', encoding='utf-8')
            cli('functions', 'download', name, '--project-ref', PROJECT, '--use-api', '--workdir', readback)
            files = {}
            for path in dependencies(stage / name / 'index.ts', stage):
                relative = path.relative_to(stage)
                actual = readback / 'supabase/functions' / relative
                if not actual.is_file() or sha(path) != sha(actual):
                    raise ValueError('Published source differs: ' + relative.as_posix())
                files[relative.as_posix()] = sha(actual)
            receipt['functions'][name] = {'files': files}
        receipt['functions'].setdefault(name, {}).update({k: item[k] for k in ('version', 'verify_jwt', 'ezbr_sha256')})
    (args.output_dir / (args.action + '.json')).write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print('DIG-3.3 runtime ' + args.action + ': verified')


if __name__ == '__main__':
    main()
