"""Safely extract the provided ZIP without overwriting an existing client."""

from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import json
import shutil
import stat

SOURCE = Path('/home/gromov/Downloads/Lineage II - The Chaotic Throne - Freya - High Five.zip')
TARGET = Path(__file__).resolve().parents[2] / 'client-high-five'

if __name__ == '__main__':
    if TARGET.exists():
        raise SystemExit(f'Каталог уже существует, перезапись запрещена: {TARGET}')
    with ZipFile(SOURCE) as archive:
        entries = archive.infolist()
        names = set()
        for entry in entries:
            path = PurePosixPath(entry.filename.replace('\\', '/'))
            if path.is_absolute() or '..' in path.parts or not path.parts or ':' in path.parts[0]:
                raise ValueError(f'Небезопасный путь в ZIP: {entry.filename}')
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError(f'Символическая ссылка в ZIP: {entry.filename}')
            if str(path) in names:
                raise ValueError(f'Повторяющийся путь в ZIP: {entry.filename}')
            names.add(str(path))
        total = sum(entry.file_size for entry in entries)
        if shutil.disk_usage(TARGET.parent).free < total + 2 * 1024**3:
            raise SystemExit('Недостаточно свободного места')
        TARGET.mkdir()
        for index, entry in enumerate(entries, 1):
            relative = PurePosixPath(entry.filename.replace('\\', '/'))
            destination = TARGET.joinpath(*relative.parts)
            if entry.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as incoming, destination.open('xb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
            if index % 250 == 0:
                print(f'Распаковано {index}/{len(entries)}', flush=True)
        print(json.dumps({'directory': str(TARGET), 'entries': len(entries), 'uncompressed_bytes': total}), flush=True)
