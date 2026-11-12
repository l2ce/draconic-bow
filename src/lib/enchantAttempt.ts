import { clampEnchant, MAX_ENCHANT } from './enchant'

export const ENCHANT_ATTEMPT_DURATION_MS = 3000
export const SAFE_ENCHANT_LEVEL = 3
const MIN_SUCCESS_CHANCE = 0.1

/** Agreed simulation curve, not a probability table extracted from the client. */
export function getEnchantSuccessChance(currentLevel: number): number {
  const level = clampEnchant(currentLevel)
  if (level >= MAX_ENCHANT) return 0
  if (level < SAFE_ENCHANT_LEVEL) return 1
  const step = (level + 1 - SAFE_ENCHANT_LEVEL) / (MAX_ENCHANT - SAFE_ENCHANT_LEVEL)
  return Math.max(MIN_SUCCESS_CHANCE, 1 - (1 - MIN_SUCCESS_CHANCE) * step)
}

export interface EnchantAttemptResult {
  fromLevel: number
  level: number
  success: boolean
}

export function resolveEnchantAttempt(currentLevel: number): EnchantAttemptResult {
  const fromLevel = clampEnchant(currentLevel)
  if (fromLevel >= MAX_ENCHANT) return { fromLevel, level: fromLevel, success: false }
  const chance = getEnchantSuccessChance(fromLevel)
  const success = chance === 1 || (chance > 0 && Math.random() < chance)
  return { fromLevel, level: success ? clampEnchant(fromLevel + 1) : 0, success }
}
