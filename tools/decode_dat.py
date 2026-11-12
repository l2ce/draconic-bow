"""Read-only decoder for this client's Lineage2Ver111 / Ver413 files.

RSA block layout and public game-format constants are documented by open-l2encdec:
https://github.com/ritsuwastaken/open-l2encdec (MIT).
The source client is never modified; decoded output must be a new file.
"""

from pathlib import Path
import argparse
import struct
import zlib

KEYS = {
    'original-413': (
        '97df398472ddf737ef0a0cd17e8d172f0fef1661a38a8ae1d6e829bc1c6e4c3c'
        'fc19292dda9ef90175e46e7394a18850b6417d03be6eea274d3ed1dde5b5d7bd'
        'e72cc0a0b71d03608655633881793a02c9a67d9ef2b45eb7c08d4be329083ce4'
        '50e68f7867b6749314d40511d09bc5744551baa86a89dc38123dc1668fd72d83',
        0x35,
    ),
    'l2encdec': (
        '75b4d6de5c016544068a1acf125869f43d2e09fc55b8b1e289556daf9b8757635'
        '593446288b3653da1ce91c87bb1a5c18f16323495c55d7d72c0890a83f69bfd1'
        'fd9434eb1c02f3e4679edfa43309319070129c267c85604d87bb65bae205de3707'
        'af1d2108881abb567c3b3d069ae67c3a4c6a3aa93d26413d4c66094ae2039',
        0x1D,
    ),
}


def decode(data: bytes) -> tuple[bytes, str]:
    header = data[:28].decode('utf-16le')
    if header == 'Lineage2Ver111':
        return bytes(value ^ 0xAC for value in data[28:-20]), 'xor-111'
    if header != 'Lineage2Ver413':
        raise ValueError('Поддерживаются только Lineage2Ver111 и Lineage2Ver413')
    body = data[28:-20]
    if len(body) % 128:
        raise ValueError('Некорректный размер RSA-блоков')
    for name, (modulus, exponent) in KEYS.items():
        blocks = bytearray()
        try:
            for offset in range(0, len(body), 128):
                block = pow(int.from_bytes(body[offset:offset + 128], 'big'), exponent, int(modulus, 16)).to_bytes(128, 'big')
                size = block[3]
                if size > 124:
                    raise ValueError('Некорректное дополнение RSA-блока')
                start = 128 - ((size + 3) & ~3)
                blocks.extend(block[start:start + size])
            expected = struct.unpack_from('<I', blocks)[0]
            if expected > 100 * 1024 * 1024:
                raise ValueError('Превышен лимит размера таблицы')
            result = zlib.decompress(blocks[4:])
            if len(result) != expected:
                raise ValueError('Размер после распаковки не совпал')
            return result, name
        except (ValueError, zlib.error, struct.error):
            continue
    raise ValueError('Ни один из стандартных ключей 413 не подошёл')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    result, key = decode(args.source.read_bytes())
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    with args.destination.open('xb') as output:
        output.write(result)
    print(f'{args.source.name}: {len(result)} байт, ключ {key} -> {args.destination}')
