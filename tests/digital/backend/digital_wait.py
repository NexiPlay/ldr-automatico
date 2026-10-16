"""Wait for a joint invocation to finish, then run the mandatory live audit."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time
import digital_release as gate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    provider = gate.Provider(os.environ.get('ELEVENLABS_API_KEY'), gate.read(gate.SPEC))
    manifest = gate.read(args.output_dir / 'manifest.json')
    deadline = time.monotonic() + 1200
    while True:
        pending = 0
        for label, item in manifest['agents'].items():
            result = provider.request('GET', 'test-invocations/' + item['invocation_id'])
            gate.save(args.output_dir / f'{label}-results.json', result)
            pending += sum(r.get('status') == 'pending' for r in result.get('test_runs', []))
        if not pending:
            break
        gate.require(time.monotonic() < deadline, 'Joint suite timed out; release blocked')
        print(f'{pending} tests pending', flush=True)
        time.sleep(20)
    subprocess.run([sys.executable, str(Path(__file__).with_name('digital_release.py')), 'verify',
                    '--output-dir', str(args.output_dir)], check=True)


if __name__ == '__main__':
    main()
