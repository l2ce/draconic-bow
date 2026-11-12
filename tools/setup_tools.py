"""Install missing pinned local tools. No sudo, system upgrades, or forced replacement.

--all installs Blender, native UModel and PSK/PSA support. Optional browser capture
runtime is separate (--browser-runtime), never a dependency of the web app.
"""

from pathlib import Path
import argparse
import hashlib
import os
import platform
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
HOME = Path.home()
OPT = HOME / '.local/opt'
BIN = HOME / '.local/bin'
CACHE = HOME / '.cache/draconic-bow/downloads'
BLENDER_VERSION = '4.5.16'
BLENDER = OPT / f'blender-{BLENDER_VERSION}-linux-x64/blender'
BLENDER_SHA = '23432b064977908beb1ab4b7f32f024e7331105c875c187dce002aff84b10c11'
PSK_SHA = '9301a57466e3d41907b4b3175a7cc0e5df80aaefcc594676e5b898fdf13e7ad2'
UMODEL_COMMIT = 'a0bfb468d42be831b126632fd8a0ae6b3614f981'
PLAYWRIGHT_VERSION = '1.65.0'


def run(command, cwd=None, env=None):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, env=env, check=True)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def download(name, url, expected):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print('Загрузка:', url, flush=True)
        with urllib.request.urlopen(url, timeout=120) as source, path.open('xb') as target:
            shutil.copyfileobj(source, target, 1024 * 1024)
    if sha256(path) != expected:
        raise SystemExit(f'Не совпал SHA256: {path}. Файл не удаляется автоматически.')
    return path


def link_binary(name, target):
    BIN.mkdir(parents=True, exist_ok=True)
    link = BIN / name
    if link.exists() or link.is_symlink():
        if link.resolve() != target.resolve():
            raise SystemExit(f'Не перезаписываю существующий {link}; используйте {target} напрямую.')
    else:
        link.symlink_to(target)


def install_blender():
    if not BLENDER.exists():
        target = BLENDER.parent
        if target.exists():
            raise SystemExit(f'Каталог уже существует, но бинарник не найден: {target}')
        OPT.mkdir(parents=True, exist_ok=True)
        archive = download(f'blender-{BLENDER_VERSION}-linux-x64.tar.xz', f'https://download.blender.org/release/Blender4.5/blender-{BLENDER_VERSION}-linux-x64.tar.xz', BLENDER_SHA)
        with tarfile.open(archive) as package:
            package.extractall(OPT, filter='data')
    link_binary('blender', BLENDER)
    version = subprocess.check_output([str(BLENDER), '--version'], text=True).splitlines()[0]
    if BLENDER_VERSION not in version:
        raise SystemExit(f'Неожиданная версия: {version}')
    print(version)


def install_umodel():
    target = OPT / 'umodel-linux/umodel64'
    if not target.exists():
        for executable in ['git', 'gcc', 'g++', 'make', 'perl', 'pkg-config', 'bash']:
            if not shutil.which(executable):
                raise SystemExit(f'Нужен системный инструмент {executable}; скрипт не устанавливает системные пакеты.')
        run(['pkg-config', '--exists', 'sdl2', 'libpng', 'zlib'])
        repo = PROJECT.parent / 'asset-work/tools/UEViewer'
        if not repo.exists():
            repo.parent.mkdir(parents=True, exist_ok=True)
            run(['git', 'clone', '--filter=blob:none', '--no-checkout', 'https://github.com/gildor2/UEViewer.git', repo])
            run(['git', '-C', repo, 'checkout', '--detach', UMODEL_COMMIT])
        else:
            commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
            dirty = subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=no'], text=True).strip()
            if commit != UMODEL_COMMIT or dirty:
                raise SystemExit(f'Не изменяю существующие исходники UModel: {repo}; проверьте commit и изменения вручную.')
        run(['bash', 'build.sh', '--exe', 'umodel-linux64'], cwd=repo)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / 'umodel-linux64', target)
        target.chmod(0o755)
    link_binary('umodel', target)
    print('Нативный UModel:', target)


def install_psk():
    if not BLENDER.exists():
        raise SystemExit('Сначала установите Blender: --blender или --all')
    installed = HOME / '.config/blender/4.5/extensions/user_default/io_scene_psk_psa/blender_manifest.toml'
    if installed.exists():
        version = tomllib.loads(installed.read_text()).get('version')
        if version != '8.2.4':
            raise SystemExit(f'Не перезаписываю другую версию PSK/PSA: {version}')
        print('PSK/PSA 8.2.4 уже установлен')
        return
    url = f'https://extensions.blender.org/download/sha256:{PSK_SHA}/add-on-io-scene-psk-psa-v8.2.4.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.4.0&blender_version_max=5.0.0'
    archive = download('io-scene-psk-psa-8.2.4.zip', url, PSK_SHA)
    expression = f"import bpy; print(bpy.ops.extensions.package_install_files(filepath={str(archive)!r}, repo='user_default', enable_on_install=True))"
    # Load current preferences: never save factory defaults over user settings.
    run([BLENDER, '--background', '--python-exit-code', '1', '--python-expr', expression])


def install_browser_runtime():
    root = HOME / '.cache/draconic-bow/browser-runtime'
    manifest = root / 'node_modules/playwright/package.json'
    if manifest.exists():
        import json
        if json.loads(manifest.read_text()).get('version') != PLAYWRIGHT_VERSION:
            raise SystemExit(f'Не перезаписываю другой runtime: {root}')
        print('Браузерный runtime уже установлен:', root)
        return
    if not shutil.which('npm'):
        raise SystemExit('Нужен npm')
    env = {**os.environ, 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD': '1'}
    run(['npm', 'install', '--prefix', root, '--no-save', '--ignore-scripts', f'playwright@{PLAYWRIGHT_VERSION}'], env=env)
    print('Опциональный инструмент снимков установлен вне зависимостей веба:', root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--blender', action='store_true')
    parser.add_argument('--umodel', action='store_true')
    parser.add_argument('--psk-addon', action='store_true')
    parser.add_argument('--browser-runtime', action='store_true')
    args = parser.parse_args()
    if not any(vars(args).values()):
        parser.print_help()
        raise SystemExit(0)
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('Этот зафиксированный установщик предназначен для Linux x86-64.')
    if args.all or args.blender:
        install_blender()
    if args.all or args.umodel:
        install_umodel()
    if args.all or args.psk_addon:
        install_psk()
    if args.browser_runtime:
        install_browser_runtime()
