"""Minimal read-only UE2 package/property inspector for the supplied L2 client.

Used for effect properties that UE Viewer cannot export (FadeColor/emitters).
Only supports this client's version 123 packages and common UE1/UE2 tags.
Unknown property payloads are retained as hex, never guessed or executed.
"""

from pathlib import Path
import argparse
import json
import struct


class Cursor:
    def __init__(self, data, offset=0):
        self.data, self.offset = data, offset

    def take(self, size):
        if size < 0 or self.offset + size > len(self.data):
            raise ValueError('Out of bounds')
        value = self.data[self.offset:self.offset + size]
        self.offset += size
        return value

    def unpack(self, fmt):
        return struct.unpack(fmt, self.take(struct.calcsize(fmt)))

    def compact(self):
        first = self.take(1)[0]
        value, more = first & 63, bool(first & 64)
        for index in range(1, 5):
            if not more:
                break
            byte = self.take(1)[0]
            value |= (byte & (31 if index == 4 else 127)) << (6 + (index - 1) * 7)
            more = bool(byte & 128)
        return -value if first & 128 else value

    def string(self):
        length = self.compact()
        if not length:
            return ''
        data = self.take(length if length > 0 else -2 * length)
        return data[:(-1 if length > 0 else -2)].decode('cp1252' if length > 0 else 'utf-16le', errors='replace')


class Package:
    def __init__(self, path):
        self.name = Path(path).stem
        data = Path(path).read_bytes()
        if data[:22].decode('utf-16le', errors='ignore') == 'Lineage2Ver':
            protocol = data[:28].decode('utf-16le')
            body = data[28:-20]
            key = 0xAC if protocol == 'Lineage2Ver111' else body[0] ^ 0xC1
            data = bytes(value ^ key for value in body)
        if data[:4] != b'\xc1\x83\x2a\x9e':
            raise ValueError('Not an Unreal package')
        self.data = data
        cursor = Cursor(data, 4)
        self.version, self.licensee, self.flags = cursor.unpack('<HHI')
        if self.version != 123:
            raise ValueError(f'Unsupported package version: {self.version}')
        name_count, name_offset, export_count, export_offset, import_count, import_offset = cursor.unpack('<6i')
        cursor.offset = name_offset
        self.names = []
        for _ in range(name_count):
            self.names.append(cursor.string())
            cursor.take(4)
        cursor.offset = import_offset
        self.imports = []
        for _ in range(import_count):
            package_name = self.fname(cursor)
            class_name = self.fname(cursor)
            outer = cursor.unpack('<i')[0]
            name = self.fname(cursor)
            self.imports.append({'name': name, 'class': class_name, 'package': package_name, 'outer': outer})
        cursor.offset = export_offset
        self.exports = []
        for _ in range(export_count):
            class_index, super_index = cursor.compact(), cursor.compact()
            outer = cursor.unpack('<i')[0]
            name = self.fname(cursor)
            flags = cursor.unpack('<I')[0]
            size = cursor.compact()
            offset = cursor.compact() if size else 0
            self.exports.append({'name': name, 'class_index': class_index, 'super_index': super_index, 'outer': outer, 'flags': flags, 'size': size, 'offset': offset})

    def fname(self, cursor):
        index = cursor.compact()
        if not 0 <= index < len(self.names):
            raise ValueError(f'Unknown name {index}')
        return self.names[index]

    def entry(self, index):
        return self.exports[index - 1] if index > 0 else self.imports[-index - 1]

    def path(self, index, depth=0):
        if not index:
            return self.name
        if depth > 32:
            raise ValueError('Object cycle')
        entry = self.entry(index)
        if index < 0 and not entry['outer']:
            return entry['name']
        return self.path(entry['outer'], depth + 1) + '.' + entry['name']

    def reference(self, index):
        return None if index == 0 else {'index': index, 'path': self.path(index)}

    def value(self, name, kind, subtype, data):
        cursor = Cursor(data)
        if kind == 1 and len(data) == 1:
            return data[0]
        if kind == 2 and len(data) == 4:
            return cursor.unpack('<i')[0]
        if kind == 4 and len(data) == 4:
            return cursor.unpack('<f')[0]
        if kind in (5, 8):
            return self.reference(cursor.compact())
        if kind == 6:
            return self.fname(cursor)
        if kind == 13:
            return cursor.string()
        if kind == 10:
            if subtype == 'Color' and len(data) == 4:
                return dict(zip(('b', 'g', 'r', 'a'), data))
            if subtype == 'Vector' and len(data) == 12:
                return dict(zip('xyz', cursor.unpack('<3f')))
            if subtype == 'Rotator' and len(data) == 12:
                return dict(zip(('pitch', 'yaw', 'roll'), cursor.unpack('<3i')))
            if subtype == 'Range' and len(data) == 8:
                return dict(zip(('min', 'max'), cursor.unpack('<2f')))
            if subtype == 'RangeVector' and len(data) == 24:
                values = cursor.unpack('<6f')
                return {axis: {'min': values[index * 2], 'max': values[index * 2 + 1]} for index, axis in enumerate('xyz')}
            try:
                result = self.properties(cursor)
                if cursor.offset == len(data):
                    return result
            except (ValueError, IndexError, struct.error):
                pass
        if kind == 9:
            count = cursor.compact()
            if not 0 <= count <= 10000:
                raise ValueError('Invalid array size')
            if name in ('Emitters', 'Skins', 'Materials'):
                return [self.reference(cursor.compact()) for _ in range(count)]
            if name == 'ColorScale' and len(data) - cursor.offset == count * 8:
                return [{'time': cursor.unpack('<f')[0], 'color': dict(zip(('b', 'g', 'r', 'a'), cursor.take(4)))} for _ in range(count)]
            try:
                result = [self.properties(cursor) for _ in range(count)]
                if cursor.offset == len(data):
                    return result
            except (ValueError, IndexError, struct.error):
                pass
        return {'raw': data.hex(), 'size': len(data), 'type': kind, 'struct': subtype}

    def properties(self, cursor):
        output = {}
        for _ in range(1000):
            name = self.fname(cursor)
            if name == 'None':
                return output
            info = cursor.take(1)[0]
            kind, size_code = info & 15, (info >> 4) & 7
            if kind == 0:
                raise ValueError('Invalid property type')
            subtype = self.fname(cursor) if kind == 10 else None
            if size_code < 5:
                size = [1, 2, 4, 12, 16][size_code]
            else:
                size = cursor.unpack({5: '<B', 6: '<H', 7: '<I'}[size_code])[0]
            if kind != 3 and info & 128:
                first = cursor.take(1)[0]
                index = first
                if first & 128:
                    if first & 64:
                        rest = cursor.take(3)
                        index = ((first << 24) | int.from_bytes(rest, 'big')) & 0x3FFFFF
                    else:
                        index = ((first << 8) | cursor.take(1)[0]) & 0x3FFF
                name += f'[{index}]'
            output[name] = bool(info & 128) if kind == 3 else self.value(name, kind, subtype, cursor.take(size))
        raise ValueError('Too many properties')

    def inspect(self, index):
        entry = self.exports[index - 1]
        data = self.data[entry['offset']:entry['offset'] + entry['size']]
        result = {**entry, 'path': self.path(index), 'class': self.path(entry['class_index']) if entry['class_index'] else 'Class', 'super': self.reference(entry['super_index'])}
        if entry['class_index']:
            for start in [0, 4, 8, 16, 24, 32]:
                try:
                    cursor = Cursor(data, start)
                    properties = self.properties(cursor)
                    if properties:
                        return {**result, 'properties_offset': start, 'properties': properties, 'remaining_bytes': len(data) - cursor.offset}
                except (ValueError, IndexError, struct.error):
                    pass
        else:
            candidates = []
            allowed = set()
            current = index
            while current > 0:
                for child in self.exports:
                    if child['outer'] == current and child['class_index']:
                        cls = self.path(child['class_index']).rsplit('.', 1)[-1]
                        if cls.endswith('Property'):
                            allowed.add(child['name'])
                current = self.entry(current)['super_index']
            reserved = {'Core', 'Engine', self.name}
            for start in range(len(data)):
                try:
                    cursor = Cursor(data, start)
                    properties = self.properties(cursor)
                    keys = {key.split('[')[0] for key in properties}
                    valid = keys.issubset(allowed) if allowed else not keys.intersection(reserved)
                    if properties and valid and cursor.offset == len(data):
                        candidates.append((len(properties), start, properties))
                except (ValueError, IndexError, struct.error):
                    pass
            if candidates:
                _, start, properties = max(candidates, key=lambda item: item[0])
                return {**result, 'properties_offset': start, 'properties': properties}
        return {**result, 'raw': data.hex()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('object')
    parser.add_argument('--children', action='store_true')
    args = parser.parse_args()
    package = Package(args.source)
    selected = [index for index, entry in enumerate(package.exports, 1) if entry['name'].lower() == args.object.lower()]
    if not selected:
        raise SystemExit(f'Объект {args.object} не найден')
    if args.children:
        parents = set(selected)
        for index, entry in enumerate(package.exports, 1):
            outer = entry['outer']
            while outer > 0 and outer not in parents:
                outer = package.entry(outer)['outer']
            if outer in parents and index not in parents:
                selected.append(index)
    print(json.dumps([package.inspect(index) for index in selected], ensure_ascii=False, indent=2))
