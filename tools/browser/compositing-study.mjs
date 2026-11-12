import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { effectReady, frames, launchBrowser, loadScene, outputDirectory, saveReport, setLevel, WORK } from './runtime.mjs'

if (process.argv.includes('--help')) {
  console.log('node tools/browser/compositing-study.mjs\nСнимки раздельных слоёв, сравнение пикселей оружия и GPU-проба RGB. Только подключение к уже запущенному dev-серверу.')
  process.exit(0)
}
const directory = await outputDirectory('compositing-study')
const browser = await launchBrowser()
const report = { capturedAt: new Date().toISOString(), condition: 'Одинаковая статичная поза/камера; это диагностика веба, не кадр native UE2.', modes: [], comparisons: [], colorChips: null, errors: [] }
const images = new Map()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
  for (const level of [15, 16]) {
    for (const mode of ['base', 'aura', 'surface', 'particles', 'before', 'full', 'mask']) {
      await loadScene(page, `enchantStudy=${mode}`); await effectReady(page); await setLevel(page, level)
      await page.getByRole('button', { name: 'Приблизить', exact: true }).click(); await frames(page, 2)
      const png = await page.screenshot({ path: join(directory, `${level}-${mode}.png`) })
      images.set(`${level}-${mode}`, png.toString('base64'))
      report.modes.push({ level, mode, stencil: await page.locator('canvas').evaluate(canvas => canvas.getContext('webgl2').getContextAttributes().stencil) })
    }
    const measurement = await page.evaluate(async ({ base, aura, before, mask }) => {
      async function pixels(encoded) {
        const blob = await (await fetch('data:image/png;base64,' + encoded)).blob()
        const image = await createImageBitmap(blob)
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, image.width, image.height); image.close(); return data
      }
      const [b, a, old, m] = await Promise.all([base, aura, before, mask].map(pixels))
      const solid = (x, y) => { const i = (y * m.width + x) * 4; return m.data[i] >= 253 && m.data[i + 1] <= 2 && m.data[i + 2] >= 253 }
      let count = 0, errorSum = 0, oldSum = 0, maximum = 0, changed = 0
      for (let y = 2; y < m.height - 2; y++) for (let x = 2; x < m.width - 2; x++) {
        let interior = true
        for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++) if (!solid(x + dx, y + dy)) interior = false
        if (!interior) continue
        count++; const i = (y * m.width + x) * 4; let difference = 0
        for (let c = 0; c < 3; c++) {
          const error = Math.abs(a.data[i + c] - b.data[i + c]); errorSum += error; difference += error; maximum = Math.max(maximum, error)
          oldSum += Math.abs(old.data[i + c] - b.data[i + c])
        }
        if (difference) changed++
      }
      return { protectedInteriorPixels: count, auraChangedWeaponPixels: changed, maxAuraChannelDifference: maximum, meanAuraChannelDifference: count ? errorSum / (count * 3) : null, meanPreviousChannelDifference: count ? oldSum / (count * 3) : null }
    }, { base: images.get(`${level}-base`), aura: images.get(`${level}-aura`), before: images.get(`${level}-before`), mask: images.get(`${level}-mask`) })
    report.comparisons.push({ level, ...measurement })
  }
  report.colorChips = await page.evaluate(async () => {
    const transformed = await (await fetch('/src/viewer/ViewerEngine.ts')).text()
    const optimized = transformed.match(/from\s*["']([^"']*\/three\.js[^"']*)["']/)?.[1]
    if (!optimized) return { unavailable: 'Не найден текущий импорт Three.js' }
    const T = await import(optimized)
    const renderer = new T.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true })
    renderer.setSize(1, 1); renderer.outputColorSpace = T.SRGBColorSpace
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    const uniform = new T.Vector3()
    const material = new T.ShaderMaterial({ toneMapped: false, uniforms: { tint: { value: uniform } }, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: 'uniform vec3 tint;void main(){gl_FragColor=vec4(tint,1.);\n#include <colorspace_fragment>\n}' })
    const scene = new T.Scene(); const mesh = new T.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh)
    const camera = new T.Camera(), gl = renderer.getContext(), pixel = new Uint8Array(4), result = []
    for (const rgb of [[160, 20, 20], [130, 10, 0]]) {
      uniform.set(...rgb.map(value => value / 255)); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      const previous = Array.from(pixel.slice(0, 3)); const color = new T.Color().setRGB(...rgb.map(value => value / 255), T.SRGBColorSpace)
      uniform.set(color.r, color.g, color.b); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      result.push({ source: rgb, previous, corrected: Array.from(pixel.slice(0, 3)), condition: 'Белый участок карты, без смешивания со сценой' })
    }
    material.dispose(); geometry.dispose(); renderer.dispose(); renderer.forceContextLoss(); return result
  })
  await saveReport(directory, report)
  await writeFile(join(WORK, 'enchant/compositing-study.json'), JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
