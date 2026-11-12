"""Run with Blender: blender -b --python tools/build_character.py

Builds the fixed scene from extracted client resources. Generated .blend files
are in asset-work; save hand-edited copies under a different name.
"""

from pathlib import Path
import json

import bpy
from mathutils import Matrix, Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module='bl_ext.user_default.io_scene_psk_psa')
from bl_ext.user_default.io_scene_psk_psa.psk.reader import read_psk
from bl_ext.user_default.io_scene_psk_psa.psk.importer import import_psk, PskImportOptions
from bl_ext.user_default.io_scene_psk_psa.psa.reader import PsaReader
from bl_ext.user_default.io_scene_psk_psa.psa.importer import import_psa, PsaImportOptions

PROJECT = Path(__file__).resolve().parents[1]
WORK = PROJECT.parent / 'asset-work'
EXPORTS = WORK / 'exports'
SELECTION = json.loads((WORK / 'reports/asset-selection.json').read_text())
TEXTURES = WORK / 'textures'
PREVIEWS = WORK / 'previews'
TEXTURES.mkdir(exist_ok=True)
PREVIEWS.mkdir(exist_ok=True)
(PROJECT / 'public/models').mkdir(exist_ok=True)

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 30
root = bpy.data.objects.new('Human Female Fighter · Plated Leather · Draconic Bow', None)
scene.collection.objects.link(root)
root.scale = (0.01, 0.01, 0.01)
rig = None
character_objects = [root]
report = {'parts': [], 'animations': [], 'warnings': []}


def find_texture(reference):
    package, name = reference.split('.', 1)
    direct = EXPORTS / package / 'Texture' / f'{name}.tga'
    if direct.exists():
        return direct
    material_files = list((EXPORTS / package).glob(f'*/{name}.mat'))
    if not material_files:
        raise FileNotFoundError(reference)
    values = dict(line.split('=', 1) for line in material_files[0].read_text().splitlines() if '=' in line)
    return EXPORTS / package / 'Texture' / (values['Diffuse'] + '.tga')


def make_material(reference, role):
    name = reference.split('.', 1)[1]
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    path = find_texture(reference)
    image = bpy.data.images.load(str(path), check_existing=True)
    # Blender loads pixels lazily; load the source before changing its filepath.
    if len(image.pixels) == 0:
        raise ValueError(f'Не удалось прочитать текстуру {path}')
    _ = image.pixels[0]
    image.alpha_mode = 'CHANNEL_PACKED' if role not in ('hair_alpha', 'bow') else 'STRAIGHT'
    png = TEXTURES / (path.stem + '.png')
    image.file_format = 'PNG'
    image.save(filepath=str(png), save_copy=True)
    image = bpy.data.images.load(str(png), check_existing=True)
    image.alpha_mode = 'CHANNEL_PACKED' if role not in ('hair_alpha', 'bow') else 'STRAIGHT'
    image.pack()
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = role not in ('hair', 'hair_alpha', 'bow')
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    texture = material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Linear'
    material.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.52 if role == 'bow' else 0.7
    bsdf.inputs['Metallic'].default_value = 0.25 if role == 'bow' else 0.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.35
    if role in ('hair_alpha', 'bow'):
        # GLB BLEND does not express native BLEND + AlphaTest + ZWrite together.
        # The web loader restores the bow's native flags in src/lib/bowMaterial.ts.
        material.node_tree.links.new(texture.outputs['Alpha'], bsdf.inputs['Alpha'])
        material.surface_render_method = 'DITHERED'
    return material


for part in SELECTION['parts']:
    package, name = part['mesh'].split('.', 1)
    psk = read_psk(str(EXPORTS / package / 'SkeletalMesh' / (name + '.psk')))
    options = PskImportOptions()
    options.should_import_materials = False
    imported = import_psk(psk, bpy.context, name, options)
    mesh = imported.mesh_object
    mesh.name = part['role']
    source_rig = imported.armature_object
    report['warnings'].extend(imported.warnings)
    source_material_count = len(psk.materials)
    for index in range(max(1, source_material_count)):
        reference = part['materials'][min(index, len(part['materials']) - 1)]
        mesh.data.materials.append(make_material(reference, part['role']))
    if part['role'] == 'bow':
        for modifier in list(mesh.modifiers):
            if modifier.type == 'ARMATURE':
                mesh.modifiers.remove(modifier)
        mesh.vertex_groups.clear()
        mesh.parent = rig
        mesh.parent_type = 'BONE'
        mesh.parent_bone = 'Weapon_L_Bone'
        mesh.matrix_parent_inverse = Matrix.Translation((0, -rig.data.bones['Weapon_L_Bone'].length, 0))
        mesh.matrix_basis = Matrix.Identity(4)
        bpy.data.objects.remove(source_rig, do_unlink=True)
    elif rig is None:
        rig = source_rig
        rig.name = 'HumanFemaleFighter_Rig'
        rig.parent = root
        character_objects.append(rig)
    else:
        differences = []
        for bone in source_rig.data.bones:
            target = rig.data.bones.get(bone.name)
            if target is None:
                raise ValueError(f'В основном скелете нет кости {bone.name}')
            differences.append(max(abs(value) for row in (target.matrix_local - bone.matrix_local) for value in row))
        if max(differences, default=0) > 0.01:
            raise ValueError(f'Несовместимая bind pose: {part["role"]}, ошибка {max(differences)}')
        mesh.parent = rig
        for modifier in mesh.modifiers:
            if modifier.type == 'ARMATURE':
                modifier.object = rig
        bpy.data.objects.remove(source_rig, do_unlink=True)
    character_objects.append(mesh)
    report['parts'].append({'role': part['role'], 'vertices': len(mesh.data.vertices), 'triangles': len(mesh.data.polygons), 'material_slots': source_material_count})

psa_path = EXPORTS / 'Fighter/MeshAnimation/FFighter_anim.psa'
with PsaReader(str(psa_path)) as reader:
    options = PsaImportOptions(
        sequence_names=list(SELECTION['animations'].values()),
        fps_source='CUSTOM', fps_custom=30,
        should_use_fake_user=True,
    )
    result = import_psa(bpy.context, reader, rig, options)
    report['warnings'].extend(result.warnings)
    for name, original in SELECTION['animations'].items():
        action = bpy.data.actions[original]
        action.name = name
        action['source_sequence'] = original
        sequence = reader.sequences[original]
        end_frame = round(sequence.frame_count / sequence.fps * scene.render.fps)
        for bone in rig.data.bones:
            if bone.parent is not None:
                continue
            curves = [action.fcurves.find(f'pose.bones["{bone.name}"].location', index=index) for index in range(3)]
            if any(curve is None for curve in curves):
                continue
            rotation = bone.matrix_local.to_3x3()
            inverse = rotation.inverted()
            first = rotation @ Vector([curve.evaluate(0) for curve in curves])
            for frame in range(int(action.frame_range[1]) + 1):
                world = rotation @ Vector([curve.evaluate(frame) for curve in curves])
                world.x, world.y = first.x, first.y
                fixed = inverse @ world
                for axis, curve in enumerate(curves):
                    curve.keyframe_points[frame].co.y = fixed[axis]
        for curve in action.fcurves:
            curve.keyframe_points.insert(end_frame, curve.evaluate(0), options={'FAST'})
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
            curve.update()
        report['animations'].append({'name': name, 'source': original, 'source_fps': sequence.fps, 'duration': end_frame / 30})

rig.animation_data_create()
rig.animation_data.action = bpy.data.actions['idle']
rig.animation_data.action_slot = bpy.data.actions['idle'].slots[0]
scene.frame_start = 0
scene.frame_end = int(bpy.data.actions['idle'].frame_range[1])
scene.frame_set(0)
bpy.context.view_layer.update()

# Client units are not meters. Normalize the body, not the weapon, to 1.72 m.
depsgraph = bpy.context.evaluated_depsgraph_get()
points = []
for obj in character_objects:
    if obj.type != 'MESH' or obj.name == 'bow':
        continue
    evaluated = obj.evaluated_get(depsgraph)
    points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
minimum_z = min(point.z for point in points)
height = max(point.z for point in points) - minimum_z
factor = 1.72 / height
root.scale *= factor
root.location.z = -minimum_z * factor
bpy.context.view_layer.update()
report['body_height_meters'] = 1.72

# Export only character objects, not the preview camera, lights or floor.
bpy.ops.object.select_all(action='DESELECT')
for obj in character_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
glb = PROJECT / 'public/models/human-female-plated-draconic.glb'
bpy.ops.export_scene.gltf(
    filepath=str(glb), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_frame_range=False,
    export_cameras=False, export_lights=False,
)

# A separate preview stage also makes the saved .blend useful when opened manually.
world = bpy.data.worlds.new('Preview World')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.16, 0.2, 0.2, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
scene.world = world
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.015))
floor = bpy.context.object
floor.name = 'Preview Floor'
floor_material = bpy.data.materials.new('Preview Floor')
floor_material.diffuse_color = (0.035, 0.045, 0.045, 1)
floor.data.materials.append(floor_material)

for name, location, energy, size, color in [
    ('Key', (3, -4, 5), 550, 4, (1.0, 0.88, 0.73)),
    ('Fill', (-3, -2, 3), 350, 4, (0.75, 0.86, 1.0)),
    ('Rim', (1, 3, 4), 650, 3, (0.77, 1.0, 0.94)),
]:
    light = bpy.data.lights.new(name, 'AREA')
    light.energy, light.shape, light.size, light.color = energy, 'DISK', size, color
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, 0.9)) - obj.location).to_track_quat('-Z', 'Y').to_euler()

camera_data = bpy.data.cameras.new('Preview Camera')
camera = bpy.data.objects.new('Preview Camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.lens = 55
camera.location = (2.7, -4.8, 2.3)
camera.rotation_euler = (Vector((0, 0, 0.95)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'CYCLES'
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = 'OPTIX'
preferences.get_devices_for_type('OPTIX')
for device in preferences.devices:
    device.use = device.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.cycles.samples = 24
scene.render.resolution_x = 640
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'

for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
            area.spaces.active.overlay.show_overlays = False

bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
blend = WORK / 'human-female-plated-draconic.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
report.update({'blend': str(blend), 'glb': str(glb), 'glb_bytes': glb.stat().st_size, 'bones': len(rig.data.bones)})
(WORK / 'reports/character-build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))

for name, location in [('front', (0, -4.5, 1.6)), ('back', (0, 4.5, 1.6)), ('quarter', (2.7, -4.8, 2.3))]:
    camera.location = location
    camera.rotation_euler = (Vector((0, 0, 0.9)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(PREVIEWS / (name + '.png'))
    bpy.ops.render.render(write_still=True)

print('CHARACTER_BUILD_OK', json.dumps(report, ensure_ascii=False), flush=True)
