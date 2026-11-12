/** Visual diagnostics only; ignored by production builds. No gameplay settings. */
export const ENCHANT_STUDY_LABELS = {
  base: 'Только исходное оружие',
  'bow-blend': 'Прежняя ошибка прозрачности лука · без эффектов',
  aura: 'Только исправленная аура',
  'aura-srgb': 'Аура с прежней яркостью · без подсветки деталей',
  'aura-data': 'Проба карты интенсивности без sRGB',
  volume: 'Мягкая объёмная аура — без подсветки текстуры',
  'volume-full': 'Объёмная аура и подсветка деталей оружия',
  surface: 'Только прежний поверхностный слой',
  particles: 'Только исходные частицы',
  before: 'Прежнее наложение для сравнения',
  full: 'Исправленный эффект целиком',
  mask: 'Маска защиты текстуры оружия',
} as const

export type EnchantStudyMode = keyof typeof ENCHANT_STUDY_LABELS

export function getEnchantStudyMode(): EnchantStudyMode | null {
  if (!import.meta.env.DEV) return null
  const mode = new URLSearchParams(window.location.search).get('enchantStudy')
  return mode && Object.hasOwn(ENCHANT_STUDY_LABELS, mode) ? mode as EnchantStudyMode : null
}
