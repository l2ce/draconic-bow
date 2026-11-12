"""Convert extracted TGA effects to PNG without opening/saving any .blend."""

from pathlib import Path
import json
import bpy

project = Path(__file__).resolve().parents[1]
jobs = json.loads((project.parent / 'asset-work/enchant/texture-jobs.json').read_text())
for job in jobs:
    image = bpy.data.images.load(job['source'])
    image.alpha_mode = 'CHANNEL_PACKED'
    if len(image.pixels) == 0:
        raise ValueError(f'Не удалось прочитать {job["source"]}')
    image.file_format = 'PNG'
    image.save(filepath=job['destination'], save_copy=True)
    print(job['destination'], tuple(image.size), flush=True)
    bpy.data.images.remove(image)
