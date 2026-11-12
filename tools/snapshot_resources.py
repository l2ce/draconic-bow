"""Read-only provenance snapshot; writes hashes, never changes client/assets."""

from pathlib import Path
import argparse
import hashlib
import json
import subprocess

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
CLIENT = ROOT / 'client-high-five'
WORK = ROOT / 'asset-work'
ARCHIVE = Path('/home/gromov/Downloads/Lineage II - The Chaotic Throne - Freya - High Five.zip')


def fingerprint(path, with_hash=True):
    result = {'path': str(path), 'bytes': path.stat().st_size}
    if with_hash:
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        result['sha256'] = digest.hexdigest()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hash-archive', action='store_true', help='Also read/hash the 5.59 GiB source ZIP')
    args = parser.parse_args()
    source_files = [
        'Animations/Fighter.ukx', 'Animations/LineageWeapons.ukx',
        'SysTextures/FFighter.utx', 'SysTextures/LineageWeaponsTex.utx',
        'SysTextures/LineageEffectsTextures.utx', 'SysTextures/GoldCubes.utx',
        'system/Armorgrp.dat', 'system/Weapongrp.dat', 'system/ItemName-e.dat',
        'system/Env.int', 'system/Engine.u', 'system/LineageEffect.u',
    ]
    schema_files = ['armorgrp.xml', 'weapongrp.xml', 'itemname.xml']
    lock = json.loads((PROJECT / 'package-lock.json').read_text())['packages']
    packages = {name: lock['node_modules/' + name]['version'] for name in ['react', 'react-dom', 'three', 'vite', 'typescript', '@vitejs/plugin-react']}
    source_repo = WORK / 'tools/UEViewer'
    commit = subprocess.check_output(['git', '-C', str(source_repo), 'rev-parse', 'HEAD'], text=True).strip()
    report = {
        'note': 'Local provenance snapshot; screenshots/probes are not proof of identical native UE2 rendering.',
        'archive': fingerprint(ARCHIVE, args.hash_archive),
        'client': [fingerprint(CLIENT / name) for name in source_files],
        'schemas': [fingerprint(PROJECT / 'tools/schemas' / name) for name in schema_files],
        'sourceFiles': [fingerprint(path) for directory in ['src', 'tools'] for path in sorted((PROJECT / directory).rglob('*')) if path.is_file() and path.suffix in ['.ts', '.tsx', '.css', '.py', '.mjs']],
        'projectConfig': [fingerprint(PROJECT / name) for name in ['package.json', 'package-lock.json', 'vite.config.ts', 'eslint.config.js', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'index.html']],
        'documentation': [fingerprint(path) for path in sorted(PROJECT.glob('*.md'))] + [fingerprint(path) for path in sorted((PROJECT / 'docs').glob('*.md'))] + [fingerprint(PROJECT / name) for name in ['tools/README.md', 'tools/schemas/README.md']],
        'webAssets': [fingerprint(path) for path in sorted((PROJECT / 'public').rglob('*')) if path.is_file()],
        'packagesFromLockfile': packages,
        'umodel': {'sourceRepository': str(source_repo), 'commit': commit, 'binary': str(Path('/home/gromov/.local/bin/umodel').resolve())},
        'blenderBinary': str(Path('/home/gromov/.local/bin/blender').resolve()),
    }
    target = WORK / 'reports/resource-manifest.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(target)
    print('Source files:', len(report['client']), 'web assets:', len(report['webAssets']))
