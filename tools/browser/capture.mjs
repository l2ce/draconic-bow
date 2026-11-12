import { join } from 'node:path'
import { BASE_URL, effectReady, frames, launchBrowser, loadScene, outputDirectory, saveReport, setLevel } from './runtime.mjs'

const scenario = process.argv[2]
if (!scenario || scenario === '--help') {
  console.log('Ручные визуальные сценарии: node tools/browser/capture.mjs scene|enchant|errors|bow|volume|motion\nСервер запускает пользователь. Снимки/JSON: ../asset-work/reports/browser-captures/.\nНастройка необязательного runtime: python3 tools/setup_tools.py --browser-runtime')
  process.exit(0)
}
if (!['scene', 'enchant', 'errors', 'bow', 'volume', 'motion'].includes(scenario)) throw new Error('Неизвестный сценарий; используйте --help')
const directory = await outputDirectory(scenario)
const browser = await launchBrowser()
const report = { scenario, url: BASE_URL, capturedAt: new Date().toISOString(), notes: 'Визуальная диагностика, не тестовая инфраструктура и не захват игрового клиента.', errors: [], observations: [] }
let modelRequests = 0
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
  page.on('request', request => { if (request.url().includes('human-female-plated-draconic.glb')) modelRequests++ })
  const capture = name => page.screenshot({ path: join(directory, name + '.png') })

  if (scenario === 'scene') {
    await loadScene(page)
    await capture('desktop')
    report.observations.push({ text: await page.locator('body').innerText(), canvasCount: await page.locator('canvas').count() })
    for (const name of ['Ходьба', 'Бег']) {
      await page.getByRole('button', { name: new RegExp(name) }).click()
      await frames(page, 25)
      await capture(name === 'Бег' ? 'run' : 'walk')
    }
    await page.getByRole('button', { name: 'Приостановить анимацию' }).click()
    await page.getByRole('button', { name: 'Приблизить', exact: true }).click()
    await page.mouse.move(1000, 450); await page.mouse.down(); await page.mouse.move(1250, 450, { steps: 15 }); await page.mouse.up()
    await capture('orbit')
    await page.getByRole('button', { name: /Отображение/ }).click()
    await page.getByRole('switch', { name: 'Каркас модели' }).click()
    report.observations.push({ switches: await page.getByRole('switch').evaluateAll(elements => elements.map(element => ({ name: element.innerText, checked: element.getAttribute('aria-checked') }))) })
    await page.getByRole('switch', { name: 'Каркас модели' }).click()
    await page.getByRole('button', { name: /Отображение/ }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Сбросить камеру', exact: true }).click()
    await capture('mobile')
  }

  if (scenario === 'enchant') {
    await loadScene(page); await effectReady(page)
    await page.getByRole('button', { name: 'Приостановить анимацию' }).click()
    await page.getByRole('button', { name: 'Приблизить', exact: true }).click()
    await capture('00')
    const requestsBefore = modelRequests
    for (let level = 1; level <= 16; level++) {
      await page.getByRole('button', { name: 'Заточить оружие на +1', exact: true }).click()
      if ([3, 4, 6, 7, 10, 15, 16].includes(level)) {
        await frames(page)
        await capture(String(level).padStart(2, '0'))
        report.observations.push({ level: await page.locator('.enchant-counter').innerText(), hint: await page.locator('.enchant-hint').innerText() })
      }
    }
    report.observations.push({ maximumDisabled: await page.getByRole('button', { name: 'Заточить оружие на +1' }).isDisabled(), modelRequestsBefore: requestsBefore, modelRequestsAfter: modelRequests })
    await page.getByRole('button', { name: 'Продолжить анимацию' }).click()
    for (const name of ['Ходьба', 'Бег']) {
      await page.getByRole('button', { name: new RegExp(name) }).click(); await frames(page, 30)
      await capture(name === 'Бег' ? 'run-16' : 'walk-16')
    }
    await page.getByRole('button', { name: 'Приостановить анимацию' }).click()
    await page.mouse.move(1020, 430); await page.mouse.down(); await page.mouse.move(1270, 430, { steps: 15 }); await page.mouse.up(); await frames(page)
    await capture('orbit-16')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Сбросить камеру', exact: true }).click(); await frames(page)
    await capture('mobile-16')
    await page.getByRole('button', { name: 'Сбросить заточку', exact: true }).click(); await frames(page)
    await capture('reset-00')
    report.observations.push({ afterReset: await page.locator('.enchant-counter').innerText(), resetDisabled: await page.getByRole('button', { name: 'Сбросить заточку' }).isDisabled() })
  }

  if (scenario === 'errors') {
    await page.route('**/effects/fx_m_t0144.png', route => route.abort())
    await loadScene(page)
    await page.getByRole('button', { name: 'Загрузить повторно' }).waitFor()
    report.observations.push({ failure: await page.locator('.enchant-hint').innerText(), model: await page.locator('.scene-metrics').innerText(), level: await page.locator('.enchant-counter').innerText() })
    await capture('missing-texture')
    await page.unroute('**/effects/fx_m_t0144.png')
    await page.getByRole('button', { name: 'Загрузить повторно' }).click(); await effectReady(page)
    await page.locator('.enchant-increase').evaluate(button => { for (let index = 0; index < 30; index++) button.click() })
    report.observations.push({ afterThirtyClicks: await page.locator('.enchant-counter').innerText(), maximumDisabled: await page.getByRole('button', { name: 'Заточить оружие на +1' }).isDisabled() })
    await page.getByRole('button', { name: 'Сбросить заточку' }).click()
    report.observations.push({ afterReset: await page.locator('.enchant-counter').innerText() })
    // An aborted image request is intentional in this visual failure scenario.
  }

  if (scenario === 'bow') {
    await page.setViewportSize({ width: 1280, height: 960 })
    for (const view of ['side', 'front', 'back', 'quarter']) for (const mode of ['bow-blend', 'base']) {
      await loadScene(page, `enchantStudy=${mode}&studyView=${view}`); await effectReady(page)
      await page.getByRole('button', { name: 'Приблизить', exact: true }).click(); await frames(page, 2)
      await capture(`${view}-${mode}`)
      report.observations.push({ view, mode, level: '+0', effects: false })
    }
  }

  if (scenario === 'volume') {
    await page.setViewportSize({ width: 1280, height: 960 })
    for (const level of [15, 16]) for (const mode of ['full', 'volume', 'volume-full']) {
      await loadScene(page, `enchantStudy=${mode}`); await setLevel(page, level)
      await page.getByRole('button', { name: 'Приблизить', exact: true }).click(); await frames(page, 2)
      await capture(`${level}-${mode}`)
      report.observations.push({ level, mode, status: mode.startsWith('volume') ? 'Эксперимент, не обычная сцена' : 'Обычная композиция' })
    }
  }

  if (scenario === 'motion') {
    await loadScene(page, 'motionStats=1')
    for (const [clip, button] of [['idle', null], ['walk', /02.*Ходьба/], ['run', /03.*Бег/]]) {
      if (button) await page.getByRole('button', { name: button }).click()
      await page.waitForFunction(clip => document.querySelector('.motion-diagnostics pre')?.textContent.includes(`Клип: ${clip}`), clip)
      report.observations.push({ clip, stats: await page.locator('.motion-diagnostics pre').innerText(), caveat: 'Это отдельный браузер инспекции; SwiftShader FPS не равен FPS браузера пользователя.' })
      await capture(clip)
    }
  }

  await saveReport(directory, report)
} finally {
  await browser.close()
}
