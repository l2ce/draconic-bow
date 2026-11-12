"""Extract the actual High Five enchant configuration and Draconic Bow effect.

Does not modify the client, GLB or working .blend. Writes generated reports and
web resources; requires the UModel and Blender installed for the first stage.
"""

from pathlib import Path
import configparser
import hashlib
import json
import math
import re
import subprocess

from decode_dat import decode
from read_ue2 import Package
from prepare_enchant_range import prepare as prepare_range

PROJECT = Path(__file__).resolve().parents[1]
WORK = PROJECT.parent / 'asset-work'
CLIENT = PROJECT.parent / 'client-high-five'
REPORTS = WORK / 'enchant'
PUBLIC = PROJECT / 'public/effects'
REPORTS.mkdir(exist_ok=True)
PUBLIC.mkdir(exist_ok=True)


def selected(package, name):
    matches = [index for index, entry in enumerate(package.exports, 1) if entry['name'] == name]
    if len(matches) != 1:
        raise ValueError(f'Неоднозначный объект {name}: {matches}')
    return package.inspect(matches[0])


def vector(value):
    return [value[axis] for axis in 'xyz']


def ranges(value):
    return [[value[axis]['Min'], value[axis]['Max']] for axis in 'XYZ']


def main():
    raw = (CLIENT / 'system/Env.int').read_bytes()
    decoded, _ = decode(raw)
    (REPORTS / 'Env.decoded.int').write_bytes(decoded)
    ini = configparser.ConfigParser(interpolation=None, strict=False, comment_prefixes=(';', '#'))
    ini.read_string(decoded.decode('cp1252', errors='replace'))
    section = ini['EnchantEffect']
    levels = []
    for level in range(17):
        fields = {key.lower(): float(value) for key, value in re.findall(r'(\w+)\s*=\s*([-\d.]+)', section[f'Enchant{level}'])}
        levels.append({
            'level': level,
            'color1': [int(fields[key]) for key in ['r1', 'g1', 'b1']],
            'color2': [int(fields[key]) for key in ['r2', 'g2', 'b2']],
            'opacity': fields['opacity'], 'density': fields['num'],
        })

    package = Package(CLIENT / 'SysTextures/LineageEffectsTextures.utx')
    graph = {name: selected(package, name) for name in [
        'Enchant_Aura001_Shader01', 'Enchant_Aura001_Com01', 'Enchant_Aura001_Fade01',
        'Aura001_Rot', 'Aura001_Env', 'Aura001_Cube',
    ]}
    cube = graph['Aura001_Cube']['properties']
    cube_references = [cube['Faces' if index == 0 else f'Faces[{index}]']['path'] for index in range(6)]
    fade = graph['Enchant_Aura001_Fade01']['properties']
    rotator = graph['Aura001_Rot']['properties']
    if 'FadePeriod' not in fade or rotator.get('TexRotationType', 0) != 0:
        raise ValueError('Проверьте изменившуюся структуру материала клиента')

    effects = Package(CLIENT / 'system/LineageEffect.u')
    effect_index = next(index for index, entry in enumerate(effects.exports, 1) if entry['name'] == 'c_u008')
    emitter_objects = [effects.inspect(index) for index, entry in enumerate(effects.exports, 1)
                       if entry['outer'] == effect_index and entry['class_index'] and effects.path(entry['class_index']).endswith('.SpriteEmitter')]
    if len(emitter_objects) != 2 or any(item['remaining_bytes'] != 0 for item in emitter_objects):
        raise ValueError('Неожиданная структура c_u008; не подменяем её вымышленным эффектом')

    engine = Package(CLIENT / 'system/Engine.u')
    defaults = selected(engine, 'ParticleEmitter')['properties']
    if defaults.get('CoordinateSystem') != 1 or defaults.get('DrawStyle') != 3:
        raise ValueError('Ожидались относительные координаты и PTDS_Translucent')

    textures = set(cube_references)
    emitters = []
    for item in emitter_objects:
        props = {**defaults, **item['properties']}
        texture = props['Texture']['path']
        textures.add(texture)
        lifetime = props['LifetimeRange']
        emitters.append({
            'name': item['name'], 'source': item['path'],
            'texture': '/effects/' + texture.rsplit('.', 1)[1] + '.png',
            'maxParticles': props['MaxParticles'],
            'rate': props['InitialParticlesPerSecond'],
            'lifetime': [lifetime['Min'], lifetime['Max']],
            'opacity': props.get('Opacity', 1),
            'offset': vector(props['StartLocationOffset']),
            'locationRange': ranges(props['StartLocationRange']),
            'velocityRange': ranges(props['StartVelocityRange']),
            'velocityLossRange': ranges(props['VelocityLossRange']),
            'acceleration': vector(props['Acceleration']),
            'sizeRange': ranges(props['StartSizeRange']),
            'sizeScale': [[row['RelativeTime'], row['RelativeSize']] for row in props['SizeScale']],
            'startSpin': [props['StartSpinRange']['X']['Min'], props['StartSpinRange']['X']['Max']],
            'spinRate': [props['SpinsPerSecondRange']['X']['Min'], props['SpinsPerSecondRange']['X']['Max']],
            'colorMultiplier': ranges(props['ColorMultiplierRange']),
            'useColorScale': props.get('UseColorScale', False),
            'colorScale': [[row['RelativeTime'], [row['Color'][axis] for axis in ['r', 'g', 'b']]] for row in props['ColorScale']],
            'fadeIn': props.get('FadeInEndTime', 0) if props.get('FadeIn') else 0,
            'fadeOut': props.get('FadeOutStartTime', lifetime['Max']) if props.get('FadeOut') else lifetime['Max'],
            'subdivisions': [props['TextureUSubdivisions'], props['TextureVSubdivisions']],
            'lastFrame': props['SubdivisionEnd'],
            'randomFrame': props.get('UseRandomSubdivision', False),
            'direction': props['UseDirectionAs'],
        })

    weapon = next(row for row in json.loads((WORK / 'tables/weapongrp.json').read_text())['item'] if row['object_id'] == 7575)
    if weapon['effA'] != 'LineageEffect.c_u008':
        raise ValueError('Эффект оружия изменился')
    attachment = weapon['junk1A']
    range_fields = weapon['junk2A']
    if weapon['rangeA'].lower() != 'lineageweapons.rangesample':
        raise ValueError('Изменился дополнительный меш ауры оружия')
    result = {
        'version': 1, 'itemId': 7575, 'meshName': 'bow', 'maxLevel': 16,
        'meshStart': int(section['EnchantMeshShow']), 'particlesStart': int(section['EnchantEffectShow']),
        'levels': levels,
        'surface': {
            'source': section['CubeTexName'],
            'faces': ['/effects/' + reference.rsplit('.', 1)[1] + '.png' for reference in cube_references],
            'fadePeriod': fade['FadePeriod'], 'fadePhase': fade.get('FadePhase', 0),
            'rotation': [rotator['Rotation'][axis] * math.tau / 65536 for axis in ['pitch', 'yaw', 'roll']],
        },
        'attachment': {
            'sourceFields': attachment,
            'offset': [attachment['junk1A1'], attachment['junk1A2'], attachment['junk1A3']],
            'scale': attachment['junk1A4'],
        },
        'range': {
            'source': weapon['rangeA'], 'geometry': '/effects/rangesample.json',
            'scale': [range_fields['junk2A1'], range_fields['junk2A2'], range_fields['junk2A3']],
            'offset': [range_fields['junk2A4'], range_fields['junk2A5'], range_fields['junk2A6']],
        },
        'emitters': emitters,
        'provenance': {
            'env': 'system/Env.int', 'envSha256': hashlib.sha256(raw).hexdigest(),
            'material': section['CubeTexName'], 'effect': weapon['effA'],
            'emitterDefaults': 'Engine.ParticleEmitter',
            'notes': 'Client colors/thresholds/textures/emitter parameters; native UE2 rendering is reproduced in WebGL, not executed.',
        },
    }
    (REPORTS / 'source-properties.json').write_text(json.dumps({'materialGraph': graph, 'effect': effects.inspect(effect_index), 'emitters': emitter_objects, 'defaults': defaults, 'weapon': weapon}, ensure_ascii=False, indent=2))
    (PUBLIC / 'enchant.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    texture_jobs = []
    with (REPORTS / 'export.log').open('w') as log:
        command = ['umodel', '-export', '-noanim', f'-out={WORK / "exports"}', f'-path={CLIENT}', 'LineageWeapons', 'Rangesample']
        log.write(' '.join(command) + '\n')
        log.flush()
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        for reference in sorted(textures):
            name = reference.rsplit('.', 1)[1]
            command = ['umodel', '-export', f'-out={WORK / "exports"}', f'-path={CLIENT}', 'LineageEffectsTextures', name]
            log.write(' '.join(command) + '\n')
            log.flush()
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
            texture_jobs.append({'source': str(WORK / 'exports/LineageEffectsTextures/Texture' / (name + '.tga')), 'destination': str(PUBLIC / (name + '.png')), 'reference': reference})
    (REPORTS / 'texture-jobs.json').write_text(json.dumps(texture_jobs, indent=2))
    prepare_range()
    subprocess.run(['blender', '--background', '--factory-startup', '--python-exit-code', '1', '--python', str(PROJECT / 'tools/convert_enchant_textures.py')], check=True)
    print(f'Извлечено уровней: {len(levels)}, эмиттеров: {len(emitters)}, уникальных текстур: {len(textures)}')
    print(f'Свечение с +{result["meshStart"]}, частицы с +{result["particlesStart"]}')


if __name__ == '__main__':
    main()
