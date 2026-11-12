# Ресурсы сцены

Веб использует только подготовленные файлы из `public/`. Полный клиент, рабочий `.blend`, промежуточные выгрузки и отчёты для запуска и публикации не нужны.

## Происхождение

Источник — предоставленный клиент Lineage II High Five, ZIP `Lineage II - The Chaotic Throne - Freya - High Five.zip`.

- Размер ZIP: 6 004 522 343 байта.
- SHA256: `d8747a55c30425a4d52004d632619b71fc3e87f3ef8ab902fc6c9b897d6e3a40`.
- Связи моделей определены по `Armorgrp.dat`, `Weapongrp.dat`, `ItemName-e.dat`, не по внешнему сходству.

| Часть | ID | Модель | Материал |
|---|---:|---|---|
| Plated Leather | 398 | `Fighter.FFighter_m005_u` | `FFighter.FFighter_m005_t47_u` |
| Plated Leather Gaiters | 418 | `Fighter.FFighter_m007_l` | `FFighter.FFighter_m007_t47_l` |
| Plated Leather Boots | 2431 | `Fighter.FFighter_m007_b` | `FFighter.FFighter_m007_t47_b` |
| Draconic Bow | 7575 | `LineageWeapons.draconic_bow_m00_wp` | `LineageWeaponsTex.draconic_bow_t00_wp` |

Перчатки не входят в сет: используются базовые руки `Fighter.FFighter_m000_g` с `FFighter.FFighter_m000_t1000_g`. Лицо — `FFighter_m000_f`, волосы — `FFighter_m000_m00_bh` и `FFighter_m000_m00_ah` из пакета `Fighter`.

## Готовая модель

`public/models/human-female-plated-draconic.glb`: 1 511 488 байт, 8 мешей, 8 материалов, 76 костей, 3 003 треугольника. Текстуры встроены; Draco, Meshopt и KTX2 не требуются.

| Клип | Источник | Исходные ключи/с | Цикл |
|---|---|---:|---:|
| `idle` | `Wait_Bow_FFighter` | 6 | 3,333 с |
| `walk` | `Walk_Bow_FFighter` | 15 | 0,733 с |
| `run` | `Run_Bow_FFighter` | 15 | 0,800 с |

Клипы запечены на 30 Гц с линейной интерполяцией; это не лимит FPS рендера. Горизонтальная root motion снята. Лук закреплён на `Weapon_L_Bone`; стрельбы и деформации тетивы нет. Материалы UE2 перенесены приближённо в PBR.

## Свечение

Исходные пороги и цвета взяты из `[EnchantEffect]` файла `Env.int`: +0…+3 без эффекта, аура с +4, частицы с +7, красный на +16. SHA256 `Env.int`: `638b09916ef401fe9b5eae0e8f6972768bf36b2e63d9fa608bbe15864608d70f`.

- `public/effects/enchant.json` — параметры уровней, граф материала и два эмиттера `LineageEffect.c_u008`.
- `public/effects/rangesample.json` — исходный `LineageWeapons.Rangesample`: 92 точки, 180 треугольников; масштаб `(1.6, 1.3, 1.3)`.
- Четыре PNG `aura001_*` — грани кубической карты; `fx_m_t0144.png` — атлас частиц.
- Это реконструкция эффекта в WebGL, не исполнение оригинального UE2/D3D-рендера.

Шансы попыток не связаны с `Env.int`: до +3 — 100%, далее линейное снижение до 10% на +15→+16 по выбранным пользователем правилам.

## Воспроизводимость

Для подготовки ресурсов использованы Blender 4.5.16 LTS, PSK/PSA importer 8.2.4 и UModel из `gildor2/UEViewer`, commit `a0bfb468d42be831b126632fd8a0ae6b3614f981`. Точные XML-схемы таблиц и их лицензия сохранены в `tools/schemas/`: armor/weapon — `Epilogue`, itemname — `HighFive`.

Локальные данные находятся в соседних `../client-high-five/` и `../asset-work/`; инструкции — [tools/README.md](../tools/README.md). `tools/build_character.py` обновляет генерируемые файлы: ручные изменения `.blend` необходимо хранить отдельной копией.

## Права

Игровые модели и текстуры принадлежат NCSOFT и другим правообладателям. Наличие клиента не означает разрешение на публичное распространение этих ресурсов. Сторонние XML-схемы распространяются на условиях GPL-3.0-or-later; уведомления сохранены рядом с ними.
