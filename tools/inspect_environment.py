"""Read-only inventory of city/environment packages; does not change the web scene.

Uses the existing limited UE2 inspector. Generated summaries, actor properties
and optional UModel export probes stay in ../asset-work/environment-study/.
Tile-to-city associations are only hypotheses until package references confirm them.
"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct
import subprocess

from read_ue2 import Cursor, Package


PROJECT = Path(__file__).resolve().parents[1]
CLIENT = PROJECT.parent / 'client-high-five'
WORK = PROJECT.parent / 'asset-work/environment-study'

PACKAGES = [
    'StaticMeshes/Giran_Village_S.usx', 'StaticMeshes/Giran_V_SX.usx',
    'StaticMeshes/Aden_Village_S.usx', 'StaticMeshes/Godard_Village_S.usx',
    'StaticMeshes/Rune_Village_S.usx', 'StaticMeshes/Oren_V_S.usx',
    'StaticMeshes/Dion_V_SX.usx', 'StaticMeshes/GL_V_S.usx',
    'StaticMeshes/L2_Lobby.usx',
    'MAPS/22_22.unr', 'MAPS/24_18.unr', 'MAPS/19_21.unr',
    'MAPS/20_22.unr', 'MAPS/24_16.unr', 'MAPS/21_16.unr',
    'MAPS/23_24.unr', 'MAPS/lobby01.unr', 'MAPS/Lobby02.unr',
    'MAPS/skylevel.unr',
    'Textures/L2_Skies.utx', 'Textures/AW-Cubes.utx',
    'SysTextures/LineageSlideImage.utx', 'SysTextures/LogBG.utx',
    'SysTextures/CubeMaps.utx',
]

PROBES = [
    'Giran_Village_S.Giran_V_Plaza_Stair01', 'Giran_Village_S.Giran_House01',
    'Giran_Village_S.Giran_V_Plaza_Elevation', 'Giran_Village_T.Giran_floor01',
    'Giran_Village_T.Giran_wall03', 'Giran_Village_T.Giran_roof01',
    'Giran_Village_T.Giran_wall08_light', 'LineageSlideImage.sl_image_t00',
    'LineageSlideImage.sl_image_t01', 'LogBG.LogonScreen',
]


def inventory(client):
    result = {}
    for name in ('MAPS', 'StaticMeshes', 'Textures', 'SysTextures', 'Screenshot'):
        directory = client / name
        paths = sorted(path for path in directory.rglob('*') if path.is_file())
        result[name] = {
            'files': len(paths), 'bytes': sum(path.stat().st_size for path in paths),
            'extensions': dict(Counter(path.suffix.lower() for path in paths)),
        }
    return result


def actor_properties(package, entry):
    """Read the UE2 state-frame prefix, not heuristic offsets inside properties.

    The previous effect inspector's offset guesses are unsuitable for map actors:
    their RF_HasStack prefix is variable-length due to CompactIndex references.
    Unknown/native data after tagged properties is not interpreted here.
    """
    data = package.data[entry['offset']:entry['offset'] + entry['size']]
    cursor = Cursor(data)
    if entry['flags'] & 0x02000000:  # RF_HasStack
        node = cursor.compact()
        cursor.compact()  # StateNode
        cursor.take(12)  # ProbeMask and latent-action/state fields
        if node:
            cursor.compact()  # code offset
    start = cursor.offset
    properties = package.properties(cursor)
    return {'propertiesOffset': start, 'remainingNativeBytes': len(data) - cursor.offset,
            'properties': properties}


def without_raw(value):
    if isinstance(value, dict):
        if 'raw' in value and 'size' in value:
            return {key: item for key, item in value.items() if key != 'raw'}
        return {key: without_raw(item) for key, item in value.items()}
    if isinstance(value, list):
        return [without_raw(item) for item in value]
    return value


def special_summary(actor):
    fields = ('Location', 'Rotation', 'TerrainMap', 'TerrainScale', 'TerrainSectorSize',
              'Layers', 'Layers[1]', 'Layers[2]', 'AmbientBrightness', 'AmbientHue',
              'AmbientSaturation', 'bFogZone', 'DistanceFogColor', 'DistanceFogStart',
              'DistanceFogEnd', 'Brightness', 'TexUPanSpeed', 'TexVPanSpeed')
    selected = {key: value for key, value in actor['properties'].items() if key in fields}
    for key in ('Layers', 'Layers[1]', 'Layers[2]'):
        if isinstance(selected.get(key), dict):
            selected[key] = {field: value for field, value in selected[key].items()
                             if field in ('Texture', 'AlphaMap', 'UScale', 'VScale', 'TextureRotation')}
    return {key: value for key, value in actor.items() if key != 'properties'} | {
        'propertyNames': list(actor['properties'])[:50],
        'selectedProperties': without_raw(selected),
    }


def summarize(relative, client, work):
    source = client / relative
    result = {'file': relative, 'bytes': source.stat().st_size}
    with source.open('rb') as stream:
        result['sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    package = Package(source)
    classes = Counter()
    meshes = []
    actors = []
    special = []
    errors = []
    for index, entry in enumerate(package.exports, 1):
        class_path = package.path(entry['class_index']) if entry['class_index'] else 'Class'
        class_name = class_path.rsplit('.', 1)[-1]
        classes[class_name] += 1
        if class_name == 'StaticMesh':
            meshes.append({'name': entry['name'], 'path': package.path(index), 'serializedBytes': entry['size']})
        is_actor = 'StaticMeshActor' in class_name
        is_special = class_name in ('TerrainInfo', 'SkyZoneInfo', 'LevelInfo', 'ZoneInfo')
        if not (is_actor or is_special):
            continue
        try:
            inspected = actor_properties(package, entry)
            record = {'name': entry['name'], 'class': class_path, **inspected}
            (actors if is_actor else special).append(record)
        except (ValueError, IndexError, KeyError, struct.error) as error:
            errors.append({'name': entry['name'], 'error': str(error)})
    dependencies = sorted({package.path(-index) for index, entry in enumerate(package.imports, 1) if not entry['outer']})
    result.update({
        'version': package.version, 'licensee': package.licensee,
        'exportClasses': dict(classes.most_common()), 'dependencies': dependencies,
        'staticMeshes': meshes,
    })
    if source.suffix.lower() == '.unr':
        counts = Counter()
        referenced = Counter()
        for actor in actors:
            properties = actor['properties']
            for field in ('StaticMesh', 'Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot', 'Skins'):
                if field in properties:
                    counts[field] += 1
            reference = properties.get('StaticMesh')
            if isinstance(reference, dict) and 'path' in reference:
                referenced[reference['path']] += 1
        output = work / f'{source.stem}-actors.json'
        output.write_text(json.dumps({'source': relative, 'actors': actors, 'special': special, 'errors': errors}, ensure_ascii=False, indent=2))
        result.update({
            'parsedStaticMeshActors': len(actors), 'explicitActorProperties': dict(counts),
            'uniqueActorMeshes': len(referenced), 'mostUsedActorMeshes': referenced.most_common(15),
            'uniqueMeshesByPackage': dict(Counter(reference.split('.')[0] for reference in referenced)),
            'actorsWithMeshAndLocation': sum('StaticMesh' in actor['properties'] and 'Location' in actor['properties'] for actor in actors),
            'actorsWithoutTrailingNativeBytes': sum(actor['remainingNativeBytes'] == 0 for actor in actors),
            'actorReport': str(output), 'specialActorSamples': [special_summary(actor) for actor in special[:3]],
            'actorPropertyErrorCount': len(errors), 'actorPropertyErrors': errors[:10],
        })
    elif source.suffix.lower() == '.utx':
        result['textureSamples'] = [entry['name'] for entry in package.exports if entry['class_index'] and package.path(entry['class_index']).rsplit('.', 1)[-1] in ('Texture', 'Cubemap')][:60]
    return result


def export_probe(client, work, reference):
    package, name = reference.split('.', 1)
    output = work / 'export-probes'
    output.mkdir(parents=True, exist_ok=True)
    command = ['umodel', '-export', '-nooverwrite', '-noanim', '-gltf', '-png',
               f'-path={client}', f'-out={output}', package, name]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
    log = output / f'{package}-{name}.log'
    log.write_text(' '.join(command) + '\n\n' + completed.stdout + completed.stderr)
    return {'reference': reference, 'command': command, 'exitCode': completed.returncode, 'log': str(log)}


def probe_artifacts(work):
    result = []
    for path in sorted((work / 'export-probes').rglob('*')):
        if not path.is_file() or path.suffix == '.log':
            continue
        item = {'file': str(path.relative_to(work)), 'bytes': path.stat().st_size}
        if path.suffix == '.gltf':
            document = json.loads(path.read_text())
            primitives = [primitive for mesh in document.get('meshes', []) for primitive in mesh['primitives']]
            item.update({
                'triangles': sum(document['accessors'][primitive['indices']]['count'] // 3 for primitive in primitives),
                'primitives': len(primitives), 'materials': len(document.get('materials', [])),
                'hasTextureBindings': bool(document.get('images')),
                'materialNames': [material.get('name') for material in document.get('materials', [])],
            })
        elif path.suffix == '.png':
            with path.open('rb') as stream:
                header = stream.read(24)
            if header[:8] == b'\x89PNG\r\n\x1a\n':
                item['dimensions'] = list(struct.unpack('>II', header[16:24]))
        result.append(item)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, default=CLIENT)
    parser.add_argument('--work', type=Path, default=WORK)
    parser.add_argument('--package', action='append', help='Inspect only these client-relative package paths')
    parser.add_argument('--standard-probes', action='store_true', help='Also run the small, documented export sample')
    parser.add_argument('--export-probe', action='append', default=[], metavar='PACKAGE.OBJECT')
    args = parser.parse_args()
    if args.work.resolve().is_relative_to(args.client.resolve()):
        raise SystemExit('Выходной каталог не должен находиться внутри исходного клиента.')
    args.work.mkdir(parents=True, exist_ok=True)
    report = {'source': str(args.client), 'scope': 'Read-only feasibility study, not a city reconstruction',
              'inventory': inventory(args.client), 'packages': [], 'exportProbes': []}
    for relative in args.package or PACKAGES:
        try:
            result = summarize(relative, args.client, args.work)
        except (ValueError, IndexError, KeyError, OSError, struct.error) as error:
            result = {'file': relative, 'error': str(error)}
        report['packages'].append(result)
        print(json.dumps({key: result[key] for key in ('file', 'bytes', 'exportClasses', 'parsedStaticMeshActors', 'uniqueActorMeshes', 'error') if key in result}), flush=True)
    for reference in dict.fromkeys((PROBES if args.standard_probes else []) + args.export_probe):
        result = export_probe(args.client, args.work, reference)
        report['exportProbes'].append(result)
        print(json.dumps(result), flush=True)
    report['probeArtifacts'] = probe_artifacts(args.work)
    target = args.work / 'environment-feasibility.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('Report:', target, flush=True)


if __name__ == '__main__':
    main()
