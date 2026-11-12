"""List source animation sequences without importing or altering the PSA."""

from pathlib import Path
import argparse
import json
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
args = parser.parse_args()

data = args.source.read_bytes()
offset = 0
bones = []
sequences = []
sections = []
while offset + 32 <= len(data):
    name, _, size, count = struct.unpack_from('<20siii', data, offset)
    name = name.rstrip(b'\0').decode()
    sections.append({'name': name, 'size': size, 'count': count})
    offset += 32
    if name == 'BONENAMES':
        bones = [data[offset + index * size:offset + index * size + 64].split(b'\0')[0].decode() for index in range(count)]
    if name == 'ANIMINFO':
        for index in range(count):
            row = struct.unpack_from('<64s64siiiifffiii', data, offset + index * size)
            sequences.append({'name': row[0].split(b'\0')[0].decode(), 'fps': row[8], 'frames': row[11]})
    offset += size * count

print(json.dumps({'sections': sections, 'bones': bones, 'sequences': sequences}, ensure_ascii=False, indent=2))
