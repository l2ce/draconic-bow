"""Manual GPU detection/render. Does not save preferences or the character scene."""

from pathlib import Path
import argparse
import json
import sys
import bpy

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--backend', choices=['OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'], default='OPTIX')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
bpy.ops.wm.read_factory_settings(use_empty=False)
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = args.backend
preferences.get_devices_for_type(args.backend)
for device in preferences.devices:
    device.use = device.type == args.backend
selected = [device.name for device in preferences.devices if device.use]
if not selected:
    raise RuntimeError(f'Не найден GPU для {args.backend}')
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 8
scene.cycles.use_denoising = False
scene.render.resolution_x = scene.render.resolution_y = 256
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
output = Path(__file__).resolve().parents[3] / 'asset-work/diagnostics/blender-gpu'
output.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(output / 'preview.png')
bpy.ops.render.render(write_still=True)
print(json.dumps({'backend': args.backend, 'devices': selected, 'cpuEnabled': False, 'render': scene.render.filepath}, ensure_ascii=False))
