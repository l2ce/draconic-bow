"""Prepare the client's Rangesample sphere without opening a .blend file."""

from pathlib import Path
import json
import struct

PROJECT = Path(__file__).resolve().parents[1]


def prepare():
    source = PROJECT.parent / 'asset-work/exports/LineageWeapons/SkeletalMesh/Rangesample.psk'
    data = source.read_bytes()
    offset = 0
    points, wedges, faces = [], [], []
    while offset + 32 <= len(data):
        name, _, size, count = struct.unpack_from('<20siii', data, offset)
        offset += 32
        name = name.rstrip(b'\0')
        if offset + size * count > len(data):
            raise ValueError('Повреждённый PSK')
        if name == b'PNTS0000':
            for index in range(count):
                x, y, z = struct.unpack_from('<3f', data, offset + index * size)
                points.append([x, z, -y])  # Same PSK -> glTF basis as Blender.
        elif name == b'VTXW0000':
            wedges = [struct.unpack_from('<H', data, offset + index * size)[0] for index in range(count)]
        elif name == b'FACE0000':
            faces = [struct.unpack_from('<3H', data, offset + index * size) for index in range(count)]
        offset += size * count
    if not points or not wedges or not faces:
        raise ValueError('В PSK нет геометрии Rangesample')
    # PSK importer reverses winding; reproduce that conversion, not a replacement sphere.
    indices = [wedges[wedge] for face in faces for wedge in reversed(face)]
    result = {
        'version': 1, 'source': 'LineageWeapons.Rangesample',
        'positions': [component for point in points for component in point],
        'indices': indices,
        'vertices': len(points), 'triangles': len(faces),
    }
    destination = PROJECT / 'public/effects/rangesample.json'
    destination.write_text(json.dumps(result, separators=(',', ':')))
    print(f'Rangesample: {len(points)} вершин, {len(faces)} граней -> {destination}')


if __name__ == '__main__':
    prepare()
