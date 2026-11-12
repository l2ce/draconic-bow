# Скрипты проекта

Все рабочие скрипты сохранены здесь. Для воспроизведения не нужны исходники скриптов из `/tmp` или старая переписка. Внешними остаются установленные программы/библиотеки и данные клиента в соседнем `asset-work/`.

Это подготовка ресурсов и ручная визуальная диагностика, **не тестовая инфраструктура**. Скрипты не запускают Vite и не входят в `npm run check`.

**Последнее указание пользователя:** тестирует он сам и сообщает результат; агент не запускает проверки/браузерные сценарии без отдельного запроса. Старые сценарии `enchant`, `errors` и helper `setLevel` рассчитаны на прежнее мгновенное гарантированное повышение. После добавления трёхсекундных случайных попыток они требуют адаптации и не являются приёмкой новой механики.

## Установка инструментов

Нужны Linux x86-64, Python 3.12+, Node.js 24 LTS, npm. Для сборки UModel: Git, GCC/G++, Make, Perl, Bash, pkg-config, библиотеки разработки SDL2, libpng, zlib, OpenGL.

```bash
python3 tools/setup_tools.py --help
python3 tools/setup_tools.py --all
```

`--all` устанавливает только отсутствующие Blender 4.5.16, нативный UModel и PSK/PSA 8.2.4. Есть отдельные `--blender`, `--umodel`, `--psk-addon`. Нет sudo, системных обновлений, удаления каталогов или принудительной замены неизвестных файлов. Бинарники — `~/.local/opt/`, ссылки — `~/.local/bin/`; SHA256 Blender/аддона проверяются до установки. UModel собирается из закреплённого коммита, не из старого 32-битного архива.

Перенесённый установщик проверен синтаксически; повторная чистая установка всех инструментов в этой сессии не проводилась. Уже установленные инструменты были проверены на реальной сборке.

Ручная диагностика Blender отдельно от персонажа:

```bash
blender --background --factory-startup --python-exit-code 1 --python tools/blender/check_install.py
blender --background --factory-startup --python-exit-code 1 --python tools/blender/check_gpu.py
```

GPU по умолчанию OptiX; для другого backend: `... --python tools/blender/check_gpu.py -- --backend HIP`. Результаты — `../asset-work/diagnostics/`; пользовательские настройки и рабочий `.blend` не сохраняются/не меняются.

## Подготовка персонажа

Запуск из корня веба:

```bash
python3 tools/extract_client.py
python3 tools/decode_dat.py ../client-high-five/system/Armorgrp.dat ../asset-work/tables/Armorgrp.bin
python3 tools/decode_dat.py ../client-high-five/system/Weapongrp.dat ../asset-work/tables/Weapongrp.bin
python3 tools/decode_dat.py ../client-high-five/system/ItemName-e.dat ../asset-work/tables/ItemName-e.bin
python3 tools/read_item_table.py ../asset-work/tables/Armorgrp.bin tools/schemas/armorgrp.xml ../asset-work/tables/armorgrp.json
python3 tools/read_item_table.py ../asset-work/tables/Weapongrp.bin tools/schemas/weapongrp.xml ../asset-work/tables/weapongrp.json
python3 tools/read_item_table.py ../asset-work/tables/ItemName-e.bin tools/schemas/itemname.xml ../asset-work/tables/itemname.json --version HighFive
python3 tools/extract_assets.py
blender --background --python-exit-code 1 --python tools/build_character.py
```

**Это не повседневный запуск сайта.** Клиент/таблицы уже подготовлены. Распаковка и декодирование откажутся перезаписывать существующие файлы. Не удаляйте результаты ради повторного запуска. UModel и сборка обновляют генерируемые файлы; перед пересборкой сохраните отдельную копию ручных правок `.blend`.

Происхождение ресурсов описано в [docs/assets.md](../docs/assets.md). Часть путей в исторических скриптах закреплена за `/home/gromov/projects/l2`; при переносе настройте `ROOT`, `SOURCE`, `PROJECT`, `WORK`, `CLIENT`.

## Эффекты и инспекция

```bash
python3 tools/extract_enchant.py
python3 tools/inspect_native_materials.py
python3 tools/inspect_psa.py ../asset-work/exports/Fighter/MeshAnimation/FFighter_anim.psa
python3 tools/inspect_glb.py --output ../asset-work/reports/glb-animation-audit.json
python3 tools/snapshot_resources.py --hash-archive
```

| Скрипт | Назначение |
|---|---|
| `extract_client.py` | ZIP → новый каталог; защита от `..`, абсолютных путей и ссылок |
| `decode_dat.py` | Ver111 (XOR) / Ver413 (RSA + zlib), только в новый файл |
| `read_item_table.py` | Двоичные таблицы по XML; MTX/MTX3, строки, циклы, условия |
| `extract_assets.py` | Выбранные модели/материалы/PSA через UModel; `asset-selection.json` |
| `build_character.py` | Части тела, материалы, скелет, лук, три клипа, GLB и `.blend` |
| `read_ue2.py` | Ограниченный read-only инспектор UE2 v123; UnrealScript не запускается |
| `extract_enchant.py` | Env.int, граф материалов, эмиттеры, текстуры, Rangesample; вызывает два скрипта ниже |
| `convert_enchant_textures.py` | TGA → PNG через отдельный Blender |
| `prepare_enchant_range.py` | Исходная геосфера PSK → веб-JSON |
| `inspect_native_materials.py` | Внешний FinalBlend лука, defaults классов и `.uc`-описания |
| `inspect_psa.py` | Секции, кости, имена/FPS/число кадров исходных клипов |
| `inspect_glb.py` | Сырые материалы GLB, интерполяция, частота ключей, стык вращений |
| `inspect_environment.py` | Инвентаризация окружения, свойства размещений в картах, необязательный небольшой пробный экспорт |
| `snapshot_resources.py` | SHA256 источников, схем, ресурсов, исходников и версии зависимостей |
| `setup_tools.py` | Отсутствующие локальные инструменты; без принудительных замен |
| `blender/check_install.py` | Python API, GLB, диагностическая сцена и CPU-рендер |
| `blender/check_gpu.py` | Обнаружение GPU и отдельный GPU-рендер |

`inspect_glb.py` показывает **сырые свойства файла**. `alphaMode=BLEND` в GLB не означает потерю исправления лука: native-флаги восстанавливаются после GLTFLoader в `src/lib/bowMaterial.ts`.

Манифест записывается вне репозитория в `../asset-work/reports/resource-manifest.json`. `--hash-archive` дополнительно читает около 5,59 ГиБ ZIP. Без флага новый SHA256 ZIP не вычисляется.

## Исследование городского окружения

Это анализ ресурсов, **не сборка города и не замена текущего веб-фона**. Отдельные модели и текстуры Гирана экспортируются, расположение объектов читается из карт; материалы, рельеф и освещение требуют подготовки. Пользователь решил оставить существующее окружение.

```bash
python3 tools/inspect_environment.py
python3 tools/inspect_environment.py --standard-probes
```

Без флага читаются инвентарь и выбранные пакеты UE2; с `--standard-probes` UModel дополнительно пробует экспорт трёх объектов Гирана, нескольких текстур/материала и трёх изображений из UI-пакетов. Исходники клиента не меняются, EXE игры и Blender не запускаются. Для экспорта нужен уже установленный `umodel`.

Сводка/SHA256, полные свойства акторов и экспорт обновляются в `../asset-work/environment-study/`; в репозиторий не попадают. Пробы используют `-nooverwrite` и не заменяют существующие выгрузки; логи/сводка генерируются заново. Без флага также перечисляются уже имеющиеся пробные файлы. Для другой выборки есть `--package MAPS/22_22.unr`, `--export-probe Giran_Village_S.Giran_House01`, `--client` и `--work` (последний не может находиться внутри исходного клиента).

Для акторов карты учитывается переменный префикс `RF_HasStack`; не заменяйте это чтение фиксированными смещениями `Package.inspect()`. Выходной glTF UModel пока содержит цветные заглушки вместо привязанных изображений: экспорт геометрии не означает готовую текстурированную сцену.

## Ручные снимки браузера

Dev-сервер сначала запускает **пользователь**. Скрипты только подключаются, не сбрасывают кеш и не запускают второй сервер.

Необязательный runtime — библиотека автоматизации браузера, **не** `@playwright/test`. Устанавливается вне веба, не добавляется в его `package.json` / `package-lock.json`:

```bash
python3 tools/setup_tools.py --browser-runtime
node tools/browser/capture.mjs --help
node tools/browser/capture.mjs scene
node tools/browser/capture.mjs enchant
node tools/browser/capture.mjs errors
node tools/browser/capture.mjs bow
node tools/browser/capture.mjs volume
node tools/browser/capture.mjs motion
node tools/browser/compositing-study.mjs
```

Результаты — `../asset-work/reports/browser-captures/<сценарий>/`. Повторный запуск обновляет одноимённые генерируемые PNG/JSON; для истории копируйте каталог отдельно.

- `scene`: модель, движения, камера, каркас, узкий экран.
- `enchant`: уровни/пороги, максимум, сброс, запросы GLB, движения/узкий экран.
- `errors`: намеренно блокирует текстуру только в своём браузере инспекции; ошибка, восстановление и быстрые нажатия. Ожидаемый `ERR_FAILED` здесь не ошибка приложения.
- `bow`: +0 без эффектов, старая/исправленная прозрачность, четыре ракурса.
- `volume`: обычная композиция и два **экспериментальных** варианта.
- `motion`: FPS-HUD в отдельном браузере; не доказательство FPS пользователя.
- `compositing-study`: статичные раздельные слои, пиксели оружия, изолированная GPU-проба RGB. Не native D3D-захват.

| Переменная | Назначение |
|---|---|
| `L2_PLAYWRIGHT_PATH` | Абсолютный путь к `playwright/index.mjs` другого внешнего runtime |
| `L2_CHROME_PATH` | Установленный Chrome/Chromium |
| `L2_VIEWER_URL` | Адрес уже работающего сайта, по умолчанию `http://127.0.0.1:5183/` |
| `L2_CAPTURE_DIR` | Каталог генерируемых снимков |
| `L2_CAPTURE_HEADED=1` | Отдельное видимое окно вместо headless, без пользовательского профиля |

Инспектор допускает SwiftShader fallback. Для реального FPS открывайте `/?motionStats=1` **в обычном браузере пользователя**, не делайте выводы по FPS software-инспектора.
