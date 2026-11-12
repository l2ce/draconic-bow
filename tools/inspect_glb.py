"""Read GLB material/animation metadata and loop continuity, without editing it."""

from collections import Counter
from pathlib import Path
import argparse
import json
import math
import struct

PROJECT = Path(__file__).resolve().parents[1]


def inspect(path):
    data = path.read_bytes()
    if struct.unpack_from('<4sII', data) != (b'glTF', 2, len(data)):
        raise ValueError('Некорректный GLB 2.0')
    length = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + length])
    offset = 20 + length
    binary_length = struct.unpack_from('<I', data, offset)[0]
    binary = data[offset + 8:offset + 8 + binary_length]

    def values(index):
        accessor = document['accessors'][index]
        if accessor['componentType'] != 5126:
            raise ValueError('Для анимаций ожидался float accessor')
        size = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
        view = document['bufferViews'][accessor['bufferView']]
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        stride = view.get('byteStride', size * 4)
        return [struct.unpack_from('<' + 'f' * size, binary, start + index * stride) for index in range(accessor['count'])]

    report = {'source': str(path), 'bytes': len(data), 'animations': [], 'bowMaterials': []}
    for node in document['nodes']:
        if node.get('name') == 'bow':
            report['bowMaterials'] = [document['materials'][primitive['material']] for primitive in document['meshes'][node['mesh']]['primitives']]
    for animation in document.get('animations', []):
        moving = 0
        changing_step = []
        max_gap = 0
        max_rate = 0
        for channel in animation['channels']:
            sampler = animation['samplers'][channel['sampler']]
            output = values(sampler['output'])
            times = values(sampler['input'])
            difference = max(max(abs(a - b) for a, b in zip(sample, output[0])) for sample in output)
            if difference > 0.000001:
                moving += 1
                duration = times[-1][0] - times[0][0]
                max_rate = max(max_rate, (len(times) - 1) / duration if duration else 0)
                if sampler.get('interpolation', 'LINEAR') == 'STEP':
                    changing_step.append(channel['target'])
            if channel['target']['path'] == 'rotation':
                first, last = output[0], output[-1]
                dot = abs(sum(a * b for a, b in zip(first, last)))
                dot /= math.sqrt(sum(a * a for a in first) * sum(a * a for a in last))
                max_gap = max(max_gap, math.degrees(2 * math.acos(min(1, dot))))
        report['animations'].append({
            'name': animation['name'], 'interpolationCounts': dict(Counter(sampler.get('interpolation', 'LINEAR') for sampler in animation['samplers'])),
            'movingTracks': moving, 'changingStepTracks': changing_step,
            'bakedSamplesPerSecond': max_rate, 'maxLoopRotationGapDegrees': max_gap,
        })
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path, default=PROJECT / 'public/models/human-female-plated-draconic.glb')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    text = json.dumps(inspect(args.source), ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text)
