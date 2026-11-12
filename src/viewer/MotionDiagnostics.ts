import { InterpolateDiscrete } from 'three'
import type { AnimationClip } from 'three'

interface MotionSnapshot {
  clip: AnimationClip | null
  animationUpdated: boolean
  speed: number
  staticStudy: boolean
}

/** Optional local dev HUD; does not change animation timing or rendering cadence. */
export class MotionDiagnostics {
  private readonly panel = document.createElement('aside')
  private readonly text = document.createElement('pre')
  private readonly gpu: string
  private start = 0
  private previous = 0
  private frames = 0
  private updates = 0
  private intervals: number[] = []
  private previousClip: AnimationClip | null = null
  private previousAnimationState = false
  private readonly clipInfo = new WeakMap<AnimationClip, { rate: number; stepped: boolean }>()

  static create(container: HTMLElement, context: WebGLRenderingContext | WebGL2RenderingContext): MotionDiagnostics | null {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get('motionStats') !== '1') return null
    return new MotionDiagnostics(container, context)
  }

  private constructor(container: HTMLElement, context: WebGLRenderingContext | WebGL2RenderingContext) {
    this.panel.className = 'motion-diagnostics'
    this.panel.setAttribute('aria-label', 'Диагностика анимации персонажа')
    const title = document.createElement('strong')
    title.textContent = 'Движение персонажа · диагностика'
    this.text.textContent = 'Собираем статистику…'
    this.panel.append(title, this.text)
    container.append(this.panel)
    const extension = context.getExtension('WEBGL_debug_renderer_info')
    this.gpu = extension ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'Браузер не предоставил название GPU'
    document.addEventListener('visibilitychange', this.reset)
  }

  private readonly reset = (): void => {
    this.start = this.previous = this.frames = this.updates = 0
    this.intervals = []
  }

  sample(time: number, snapshot: MotionSnapshot): void {
    if (snapshot.clip !== this.previousClip || snapshot.animationUpdated !== this.previousAnimationState) {
      this.previousClip = snapshot.clip
      this.previousAnimationState = snapshot.animationUpdated
      this.reset()
      this.text.textContent = 'Собираем статистику текущего движения…'
    }
    if (!this.previous) {
      this.previous = this.start = time
      return
    }
    this.intervals.push(time - this.previous)
    this.previous = time
    this.frames += 1
    if (snapshot.animationUpdated) this.updates += 1
    const elapsed = time - this.start
    if (elapsed < 1000) return

    const ordered = this.intervals.toSorted((a, b) => a - b)
    const p95 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? 0
    const fps = this.frames * 1000 / elapsed
    const updates = this.updates * 1000 / elapsed
    const clip = snapshot.clip
    let info = clip ? this.clipInfo.get(clip) : null
    if (clip && !info) {
      let rate = 0
      let stepped = false
      for (const track of clip.tracks) {
        const size = track.getValueSize()
        let changing = false
        for (let index = size; index < track.values.length; index += 1) {
          if (Math.abs(track.values[index]! - track.values[index % size]!) > 0.00001) { changing = true; break }
        }
        if (!changing) continue
        const duration = track.times.at(-1)! - track.times[0]!
        if (duration > 0) rate = Math.max(rate, (track.times.length - 1) / duration)
        if (track.getInterpolation() === InterpolateDiscrete) stepped = true
      }
      info = { rate, stepped }
      this.clipInfo.set(clip, info)
    }
    const state = snapshot.staticStudy ? 'статичный диагностический кадр'
      : snapshot.animationUpdated ? `${updates.toFixed(1)} обновлений/с` : 'пауза или загрузка'
    this.text.textContent = [
      `Рендер: ${fps.toFixed(1)} FPS`,
      `Скелет: ${state}`,
      `Время кадра p95: ${p95.toFixed(1)} мс`,
      `Клип: ${clip?.name ?? '—'} · скорость ${snapshot.speed.toFixed(2)}×`,
      `Ключи GLB: ${info?.rate.toFixed(1) ?? '—'}/с (не лимит FPS)`,
      `Интерполяция движения: ${info?.stepped ? 'есть STEP' : clip ? 'LINEAR / quaternion' : '—'}`,
      `GPU: ${this.gpu}`,
    ].join('\n')
    this.start = time
    this.frames = this.updates = 0
    this.intervals = []
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.reset)
    this.panel.remove()
  }
}
