import { access, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const WORK = resolve(PROJECT, '../asset-work')
export const BASE_URL = process.env.L2_VIEWER_URL ?? 'http://127.0.0.1:5183/'
export const OUTPUT_ROOT = process.env.L2_CAPTURE_DIR ?? join(WORK, 'reports/browser-captures')

export async function launchBrowser() {
  const modulePath = process.env.L2_PLAYWRIGHT_PATH ?? join(homedir(), '.cache/draconic-bow/browser-runtime/node_modules/playwright/index.mjs')
  try { await access(modulePath) } catch {
    throw new Error('Нет опционального инструмента снимков. Запустите python3 tools/setup_tools.py --browser-runtime или задайте L2_PLAYWRIGHT_PATH. Зависимости веба не меняются.')
  }
  const { chromium } = await import(pathToFileURL(modulePath).href)
  let executable = process.env.L2_CHROME_PATH
  if (!executable) {
    for (const candidate of ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/google-chrome']) {
      try { await access(candidate); executable = candidate; break } catch { /* Try the next installed browser. */ }
    }
  }
  if (!executable) throw new Error('Нужен установленный Chrome/Chromium или L2_CHROME_PATH. Скрипт не устанавливает браузер и не запускает Vite.')
  return chromium.launch({ executablePath: executable, headless: process.env.L2_CAPTURE_HEADED !== '1', args: ['--enable-unsafe-swiftshader'] })
}

export async function outputDirectory(name) {
  const directory = join(OUTPUT_ROOT, name)
  await mkdir(directory, { recursive: true })
  return directory
}

export async function saveReport(directory, report) {
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

export async function frames(page, count = 12) {
  await page.evaluate(count => new Promise(resolve => {
    let current = 0
    function next() { if (++current >= count) resolve(); else requestAnimationFrame(next) }
    requestAnimationFrame(next)
  }), count)
}

export async function loadScene(page, query = '') {
  const url = new URL(BASE_URL)
  url.search = query
  // Connect only. The dev/preview server must already be running under user control.
  await page.goto(url.href, { waitUntil: 'networkidle' })
  await page.locator('.scene-metrics').filter({ hasText: 'костей' }).waitFor({ timeout: 30000 })
  await frames(page, 2)
}

export async function effectReady(page) {
  await page.waitForFunction(() => document.querySelector('.enchant-increase[aria-label]')?.disabled === false)
}

export async function setLevel(page, level) {
  await effectReady(page)
  await page.locator('.enchant-increase').evaluate((button, level) => { for (let index = 0; index < level; index++) button.click() }, level)
  await page.waitForFunction(level => document.querySelector('.enchant-counter')?.textContent === `+${level}`, level)
  await frames(page, 2)
}
