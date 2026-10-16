"""Vendor/check the exact NexiLead DIG-3.3 gate for an atomic LDR release."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'tests/digital'
MANIFEST = BUNDLE / 'upstream.json'


def checksum(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Explicit local NexiLead checkout; omit to verify')
    args = parser.parse_args()
    if args.source:
        source = args.source.resolve()
        loader = importlib.util.spec_from_file_location('source_gate', source / 'backend/digital_release.py')
        gate = importlib.util.module_from_spec(loader)
        loader.loader.exec_module(gate)
        names = list(gate.source_hashes()) + ['backend/tests/digital/package.json', 'backend/tests/digital/package-lock.json']
        dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain', '--', *names], text=True)
        if dirty.strip(): raise ValueError('Commit the suite source before vendoring')
        commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
        files = {}
        for name in sorted(names):
            dest = BUNDLE / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((source / name).read_bytes().replace(b'\r\n', b'\n'))
            files[name] = checksum(dest)
        MANIFEST.write_text(json.dumps({'repository': 'NexiPlay/nexilead', 'commit': commit, 'files': files}, indent=2)+'\n')
    manifest = json.loads(MANIFEST.read_text())
    for name, digest in manifest['files'].items():
        path = (BUNDLE / name).resolve()
        if not path.is_relative_to(BUNDLE.resolve()) or checksum(path) != digest:
            raise ValueError('Vendored gate differs from upstream manifest: ' + name)
    spec = json.loads((BUNDLE / 'prompts/digital/suite.json').read_text(encoding='utf-8'))
    binding = json.loads((ROOT / 'backend/edge-functions/_shared/ldr-approval.json').read_text())
    if any(binding[k] != spec['agents']['ldr'][k] for k in ('agent_id', 'branch_id', 'version_id')):
        raise ValueError('Dialer binding differs from the joint suite')
    karla = json.loads((BUNDLE / 'backend/edge-functions/karla-dialer/digital-approval.json').read_text())
    if any(karla[k] != spec['agents']['karla'][k] for k in ('agent_id', 'branch_id', 'version_id')):
        raise ValueError('Karla binding differs from the joint suite')
    prompt = (ROOT / 'prompts/bruno/system.md').read_text(encoding='utf-8')
    candidate = (BUNDLE / 'prompts/ldr/candidates/dig-3.1/system.md').read_text(encoding='utf-8')
    if prompt != candidate: raise ValueError('Local prompt differs from the tested candidate')
    print(f'DIG-3.3 bundle verified: {len(manifest["files"])} files, upstream {manifest["commit"]}')


if __name__ == '__main__':
    main()
