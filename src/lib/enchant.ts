export const MAX_ENCHANT = 16

export type Vec3Tuple = [number, number, number]
export type NumberRange = [number, number]
export type VectorRange = [NumberRange, NumberRange, NumberRange]

export interface EnchantLevel {
  level: number
  color1: Vec3Tuple
  color2: Vec3Tuple
  opacity: number
  density: number
}

export interface EnchantEmitter {
  name: string
  texture: string
  maxParticles: number
  rate: number
  lifetime: NumberRange
  opacity: number
  offset: Vec3Tuple
  locationRange: VectorRange
  velocityRange: VectorRange
  velocityLossRange: VectorRange
  acceleration: Vec3Tuple
  sizeRange: VectorRange
  sizeScale: [number, number][]
  startSpin: NumberRange
  spinRate: NumberRange
  colorMultiplier: VectorRange
  useColorScale: boolean
  colorScale: [number, Vec3Tuple][]
  fadeIn: number
  fadeOut: number
  subdivisions: NumberRange
  lastFrame: number
  randomFrame: boolean
  direction: number
}

export interface EnchantConfig {
  version: 1
  itemId: 7575
  meshName: 'bow'
  maxLevel: 16
  meshStart: number
  particlesStart: number
  levels: EnchantLevel[]
  surface: { faces: string[]; fadePeriod: number; fadePhase: number; rotation: Vec3Tuple }
  attachment: { offset: Vec3Tuple; scale: number }
  range: { source: string; geometry: string; scale: Vec3Tuple; offset: Vec3Tuple }
  emitters: EnchantEmitter[]
}

export type EnchantState =
  | { state: 'loading' }
  | { state: 'ready'; meshStart: number; particlesStart: number; levels: EnchantLevel[] }
  | { state: 'error'; message: string }

export function clampEnchant(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_ENCHANT, Math.max(0, Math.trunc(value))) : 0
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные параметры эффекта заточки.')
  return value as Record<string, unknown>
}

function finite(value: unknown, min = -1000, max = 1000): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('Параметр эффекта заточки вне допустимого диапазона.')
  }
}

function tuple(value: unknown, length: number, min = -1000, max = 1000): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error('Некорректный вектор эффекта заточки.')
  for (const number of value) finite(number, min, max)
}

function range(value: unknown, min = -1000, max = 1000): void {
  tuple(value, 2, min, max)
  if (value[0]! > value[1]!) throw new Error('Некорректный диапазон эффекта заточки.')
}

function vectorRange(value: unknown, min = -1000, max = 1000): void {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('Некорректный диапазон векторов эффекта.')
  for (const component of value) range(component, min, max)
}

function localTexture(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\/effects\/[\w-]+\.png$/.test(value)) {
    throw new Error('Эффект должен использовать локальные текстуры из /effects/.')
  }
}

/** Проверяем извлечённый манифест до выделения GPU-ресурсов. */
export function parseEnchantConfig(value: unknown): EnchantConfig {
  const config = record(value)
  if (config.version !== 1 || config.itemId !== 7575 || config.meshName !== 'bow' || config.maxLevel !== MAX_ENCHANT) {
    throw new Error('Ресурсы заточки не соответствуют Draconic Bow.')
  }
  finite(config.meshStart, 1, MAX_ENCHANT)
  finite(config.particlesStart, config.meshStart, MAX_ENCHANT)
  if (!Number.isInteger(config.meshStart) || !Number.isInteger(config.particlesStart)) throw new Error('Некорректные пороги заточки.')
  if (!Array.isArray(config.levels) || config.levels.length !== MAX_ENCHANT + 1) throw new Error('Нужны параметры всех уровней +0…+16.')
  for (const [index, value] of config.levels.entries()) {
    const level = record(value)
    if (level.level !== index) throw new Error('Нарушен порядок уровней заточки.')
    tuple(level.color1, 3, 0, 255)
    tuple(level.color2, 3, 0, 255)
    finite(level.opacity, 0, 1)
    finite(level.density, 0, 1)
  }
  const surface = record(config.surface)
  if (!Array.isArray(surface.faces) || surface.faces.length !== 6) throw new Error('Нужны шесть граней кубической текстуры.')
  surface.faces.forEach(localTexture)
  finite(surface.fadePeriod, 0.01, 60)
  finite(surface.fadePhase)
  tuple(surface.rotation, 3)
  const attachment = record(config.attachment)
  tuple(attachment.offset, 3)
  finite(attachment.scale, 0.01, 10)
  const aura = record(config.range)
  if (typeof aura.source !== 'string' || aura.source.toLowerCase() !== 'lineageweapons.rangesample' || aura.geometry !== '/effects/rangesample.json') {
    throw new Error('Не найден исходный меш ауры Draconic Bow.')
  }
  tuple(aura.scale, 3, 0.01, 10)
  tuple(aura.offset, 3)
  if (!Array.isArray(config.emitters) || config.emitters.length !== 2) throw new Error('Нужны два исходных эмиттера Draconic Bow.')
  for (const value of config.emitters) {
    const emitter = record(value)
    if (typeof emitter.name !== 'string') throw new Error('Нет имени эмиттера.')
    localTexture(emitter.texture)
    finite(emitter.maxParticles, 1, 64)
    if (!Number.isInteger(emitter.maxParticles)) throw new Error('Некорректное количество частиц.')
    finite(emitter.rate, 0.1, 100)
    range(emitter.lifetime, 0.1, 10)
    finite(emitter.opacity, 0, 1)
    tuple(emitter.offset, 3)
    tuple(emitter.acceleration, 3)
    for (const field of ['locationRange', 'velocityRange'] as const) vectorRange(emitter[field])
    for (const field of ['velocityLossRange', 'sizeRange', 'colorMultiplier'] as const) vectorRange(emitter[field], 0)
    range(emitter.startSpin)
    range(emitter.spinRate)
    finite(emitter.fadeIn, 0, 10)
    finite(emitter.fadeOut, 0, 10)
    tuple(emitter.subdivisions, 2, 1, 16)
    if (!emitter.subdivisions.every(Number.isInteger)) throw new Error('Некорректное разбиение текстуры частиц.')
    finite(emitter.lastFrame, 0, emitter.subdivisions[0]! * emitter.subdivisions[1]! - 1)
    if (!Number.isInteger(emitter.lastFrame) || emitter.direction !== 1 || emitter.randomFrame !== true || emitter.useColorScale !== false) {
      throw new Error('Изменился формат исходного эмиттера; требуется повторная проверка ресурсов.')
    }
    if (!Array.isArray(emitter.sizeScale) || emitter.sizeScale.length < 2 || emitter.sizeScale.length > 16) throw new Error('Некорректная кривая размера частиц.')
    let previousTime = -1
    for (const sample of emitter.sizeScale) {
      tuple(sample, 2, 0, 10)
      if (sample[0]! < previousTime || sample[0]! > 1) throw new Error('Некорректное время кривой размера.')
      previousTime = sample[0]!
    }
    if (!Array.isArray(emitter.colorScale) || emitter.colorScale.length > 16) throw new Error('Некорректная кривая цвета.')
    for (const sample of emitter.colorScale) {
      if (!Array.isArray(sample) || sample.length !== 2) throw new Error('Некорректная точка цвета.')
      finite(sample[0], 0, 1)
      tuple(sample[1], 3, 0, 255)
    }
  }
  return value as EnchantConfig
}
