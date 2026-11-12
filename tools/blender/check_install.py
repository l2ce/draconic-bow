"""Manual Blender/Python/GLB/render diagnostics, not an application test suite."""

from pathlib import Path
import json
import struct
import bpy

work = Path(__file__).resolve().parents[3] / 'asset-work/diagnostics/blender-install'
work.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 8
scene.render.resolution_x = scene.render.resolution_y = 256
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(work / 'preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(work / 'diagnostic.blend'))
bpy.ops.export_scene.gltf(filepath=str(work / 'diagnostic.glb'), export_format='GLB')
with (work / 'diagnostic.glb').open('rb') as source:
    magic, version, length = struct.unpack('<4sII', source.read(12))
if magic != b'glTF' or version != 2 or length != (work / 'diagnostic.glb').stat().st_size:
    raise RuntimeError('Некорректный GLB')
bpy.ops.render.render(write_still=True)
print(json.dumps({'version': bpy.app.version_string, 'pythonApi': True, 'glb': str(work / 'diagnostic.glb'), 'cpuRender': str(work / 'preview.png')}, ensure_ascii=False))
