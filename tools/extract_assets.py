"""Extract the fixed scene's resources; never modify the source client."""

from pathlib import Path
import json
import subprocess

ROOT = Path('/home/gromov/projects/l2')
WORK = ROOT / 'asset-work'
CLIENT = ROOT / 'client-high-five'
EXPORTS = WORK / 'exports'

armor = json.loads((WORK / 'tables/armorgrp.json').read_text())['item']
names = {row['id']: row['name'] for row in json.loads((WORK / 'tables/itemname.json').read_text())['item_name']}
parts = []
for item_id, role in [(398, 'upper'), (418, 'lower'), (2431, 'boots')]:
    row = next(row for row in armor if row['object_id'] == item_id)
    source = row['f_HumnFigh']
    if len(source['meshes']) != 1 or len(source['textures']) != 1:
        raise ValueError(f'Ожидалась одна геометрия и текстура для {item_id}')
    parts.append({'role': role, 'itemId': item_id, 'itemName': names[item_id], 'mesh': source['meshes'][0]['name'], 'materials': source['textures']})

parts.extend([
    {'role': 'hands', 'mesh': 'Fighter.FFighter_m000_g', 'materials': ['FFighter.FFighter_m000_t1000_g'], 'note': 'Базовые руки без дополнительных предметов: перчатки не входят в Plated Leather Set.'},
    {'role': 'face', 'mesh': 'Fighter.FFighter_m000_f', 'materials': ['FFighter.FFighter_m000_t00_f', 'FFighter.FFighter_m000_t00_f1']},
    {'role': 'hair', 'mesh': 'Fighter.FFighter_m000_m00_bh', 'materials': ['FFighter.FFighter_m000_t00_m00_bh']},
    {'role': 'hair_alpha', 'mesh': 'Fighter.FFighter_m000_m00_ah', 'materials': ['FFighter.FFighter_m000_t00_m00_ah']},
    {'role': 'bow', 'itemId': 7575, 'itemName': names[7575], 'mesh': 'LineageWeapons.draconic_bow_m00_wp', 'materials': ['LineageWeaponsTex.draconic_bow_t00_wp']},
])

selection = {
    'source': str(CLIENT),
    'character': 'Human Female Fighter',
    'parts': parts,
    'animationPackage': 'Fighter.FFighter_anim',
    'animations': {'idle': 'Wait_Bow_FFighter', 'walk': 'Walk_Bow_FFighter', 'run': 'Run_Bow_FFighter'},
}
(WORK / 'reports/asset-selection.json').write_text(json.dumps(selection, ensure_ascii=False, indent=2))

with (WORK / 'reports/selected-assets-export.txt').open('w') as log:
    def export(reference: str, no_animation: bool = False):
        package, name = reference.split('.', 1)
        command = ['umodel', '-export', f'-out={EXPORTS}', f'-path={CLIENT}']
        if no_animation:
            command.append('-noanim')
        command.extend([package, name])
        log.write('\n' + ' '.join(command) + '\n')
        log.flush()
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        print(reference, flush=True)

    seen = set()
    for part in parts:
        export(part['mesh'], no_animation=True)
        for material in part['materials']:
            if material not in seen:
                export(material)
                seen.add(material)
    export(selection['animationPackage'])

print('Ресурсы фиксированной сцены извлечены:', EXPORTS)
