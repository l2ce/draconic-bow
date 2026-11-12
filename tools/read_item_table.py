"""Read this client's decrypted item tables using L2ClientDat's Epilogue schema.

Schemas are external inputs, obtained from MobiusDevelopment/L2ClientDat.
This is a minimal read-only binary parser, not an editor or game server.
"""

from pathlib import Path
import argparse
import json
import struct
import xml.etree.ElementTree as ET


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def take(self, length: int) -> bytes:
        if length < 0 or self.offset + length > len(self.data):
            raise ValueError(f'Выход за границы таблицы: {self.offset}, {length}')
        value = self.data[self.offset:self.offset + length]
        self.offset += length
        return value

    def integer(self) -> int:
        return struct.unpack('<i', self.take(4))[0]

    def count(self) -> int:
        value = self.integer()
        if not 0 <= value <= 100000:
            raise ValueError(f'Некорректный счётчик {value} на {self.offset - 4}')
        return value

    def string(self) -> str:
        length = self.count()
        if length % 2:
            raise ValueError(f'Нечётная длина UTF-16: {length}')
        return self.take(length).decode('utf-16le').rstrip('\0')

    def compact_integer(self) -> int:
        first = self.take(1)[0]
        value = first & 0x3F
        negative = bool(first & 0x80)
        more = bool(first & 0x40)
        for index in range(1, 5):
            if not more:
                break
            byte = self.take(1)[0]
            value |= (byte & (0x1F if index == 4 else 0x7F)) << (6 + (index - 1) * 7)
            more = bool(byte & 0x80)
        return -value if negative else value

    def value(self, kind: str):
        if kind in ('INT', 'UINT'):
            return self.integer()
        if kind == 'FLOAT':
            return struct.unpack('<f', self.take(4))[0]
        if kind in ('UCHAR', 'UBYTE'):
            return self.take(1)[0]
        if kind == 'UNICODE':
            return self.string()
        if kind == 'ASCF':
            length = self.compact_integer()
            if not length:
                return ''
            data = self.take(length if length > 0 else -2 * length)
            return data[:(-1 if length > 0 else -2)].decode('cp1252' if length > 0 else 'utf-16le')
        if kind in ('MTX', 'MTX3'):
            meshes = []
            for _ in range(self.count()):
                mesh = {'name': self.string()}
                if kind == 'MTX3':
                    mesh['flags'] = list(self.take(2))
                meshes.append(mesh)
            textures = [self.string() for _ in range(self.count())]
            result = {'meshes': meshes, 'textures': textures}
            if kind == 'MTX3':
                result['extra'] = self.string()
            return result
        raise ValueError(f'Неизвестный reader {kind}')

    def children(self, element, scope: dict) -> dict:
        output = {}
        for child in element:
            name = child.attrib['name']
            if child.tag == 'node':
                value = self.value(child.attrib['reader'])
                scope[name] = value
                output[name] = value
            elif child.tag == 'wrapper':
                output[name] = self.children(child, scope)
            elif child.tag == 'for':
                size = child.attrib['size']
                count = scope[size[1:]] if size.startswith('#') else int(size)
                if not isinstance(count, int) or not 0 <= count <= 100000:
                    raise ValueError(f'Некорректный размер цикла {name}: {count}')
                output[name] = [self.children(child, scope.copy()) for _ in range(count)]
            elif child.tag == 'if':
                param = child.attrib['param'].removeprefix('#')
                if str(scope[param]) == child.attrib['val']:
                    output.update(self.children(child, scope))
            else:
                raise ValueError(f'Неизвестный элемент {child.tag}')
        return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('schema', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--version', default='Epilogue')
    args = parser.parse_args()
    schema = next(element for element in ET.parse(args.schema).getroot() if element.attrib.get('pattern') == args.version)
    reader = Reader(args.source.read_bytes())
    table = reader.children(schema, {})
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    with args.destination.open('x') as output:
        json.dump(table, output, ensure_ascii=False, indent=2)
    print(f'Записей: {table["data"]}, прочитано {reader.offset}/{len(reader.data)} байт -> {args.destination}')
    for item in table.get('item', table.get('item_name', [])):
        text = json.dumps(item).lower()
        if 'plated leather' in text or 'plated_leather' in text or item.get('object_id', item.get('id')) == 7575:
            print(json.dumps(item, ensure_ascii=False, indent=2))
