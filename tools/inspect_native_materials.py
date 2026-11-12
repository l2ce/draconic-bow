"""Reproduce native material/default/script reports without changing the client."""

from pathlib import Path
import json
import subprocess

from read_ue2 import Cursor, Package

PROJECT = Path(__file__).resolve().parents[1]
WORK = PROJECT.parent / 'asset-work'
CLIENT = PROJECT.parent / 'client-high-five'

if __name__ == '__main__':
    out = WORK / 'enchant'
    out.mkdir(parents=True, exist_ok=True)
    with (out / 'draconic-bow-material-native.txt').open('w') as report:
        subprocess.run(['umodel', '-dump', '-all', f'-path={CLIENT}', 'LineageWeaponsTex', 'draconic_bow_t00_wp'], stdout=report, stderr=subprocess.STDOUT, check=True)
    package = Package(CLIENT / 'SysTextures/LineageWeaponsTex.utx')
    index = next(index for index, entry in enumerate(package.exports, 1) if entry['name'] == 'draconic_bow_t00_wp')
    (out / 'draconic-bow-material-native.json').write_text(json.dumps(package.inspect(index), ensure_ascii=False, indent=2))
    engine = Package(CLIENT / 'system/Engine.u')
    defaults = {}
    reports = WORK / 'reports'
    reports.mkdir(exist_ok=True)
    for name in ['Shader', 'Combiner', 'TexEnvMap', 'FadeColor', 'TexRotator', 'ParticleEmitter', 'SpriteEmitter', 'FinalBlend']:
        index = next(index for index, entry in enumerate(engine.exports, 1) if entry['name'] == name and entry['class_index'] == 0)
        inspected = engine.inspect(index)
        defaults[name] = {'source': inspected['path'], 'properties': inspected.get('properties', {}), 'note': 'Serialized class defaults, not captured native runtime overrides.'}
        for entry in engine.exports:
            if entry['name'] == 'ScriptText' and entry['outer'] == index:
                cursor = Cursor(engine.data, entry['offset'])
                engine.properties(cursor)
                cursor.take(8)
                (reports / (name + '.uc')).write_text(cursor.string())
    (out / 'native-material-defaults.json').write_text(json.dumps(defaults, ensure_ascii=False, indent=2))
    print('Отчёты материалов:', out)
    print('UnrealScript-описания (только чтение, не запуск):', reports)
