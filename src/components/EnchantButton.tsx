import type { CSSProperties } from 'react'
import type { EnchantProcess } from '../hooks/useEnchantAttempt'
import { MAX_ENCHANT } from '../lib/enchant'
import type { EnchantState } from '../lib/enchant'
import { Icon } from './Icon'

interface Props {
  state: EnchantState
  level: number
  ready: boolean
  chance: string
  process: EnchantProcess
  onRetry: () => void
}

export function EnchantButton({ state, level, ready, chance, process, onRetry }: Props) {
  const { attempt, progress, result, feedback, busy, blocked, start, reset } = process
  const atMaximum = level >= MAX_ENCHANT
  const showResult = ready && feedback && result !== null && result.level === level
  let title: string
  let subtitle: string
  let icon: 'plus' | 'check' | 'close' | 'reset' = 'plus'
  let stateClass = 'is-idle'
  let onClick = start
  let disabled = !ready || blocked
  let spinning = false

  if (state.state === 'error') {
    title = 'Эффект недоступен'
    subtitle = 'Повторить загрузку'
    icon = 'reset'
    stateClass = 'has-error'
    onClick = onRetry
    disabled = blocked
  } else if (!ready) {
    title = 'Подготавливаем оружие…'
    subtitle = 'Загрузка модели и эффекта'
    stateClass = 'is-loading'
    spinning = true
  } else if (attempt) {
    title = `Заточка до +${attempt.fromLevel + 1}…`
    subtitle = `Шанс успеха ${chance}`
    stateClass = 'is-enchanting'
  } else if (showResult) {
    title = result.success ? `Успех! Уровень +${result.level}` : 'Неудача — уровень +0'
    subtitle = result.success
      ? atMaximum ? 'Достигнут максимальный уровень' : `Следующий уровень +${level + 1}`
      : 'Начинаем заново'
    icon = result.success ? 'check' : 'close'
    stateClass = result.success ? 'is-success' : 'is-failure'
  } else if (atMaximum) {
    title = 'Достигнут +16'
    subtitle = 'Начать заново с +0'
    icon = 'reset'
    stateClass = 'is-maximum'
    onClick = reset
  } else {
    title = `Заточить на +${level + 1}`
    subtitle = `Шанс успеха ${chance}`
  }

  const fill = ready && busy ? progress : showResult ? 100 : 0
  const style = { '--attempt-progress': `${fill}%` } as CSSProperties
  const announcement = ready && attempt ? `Заточка до +${attempt.fromLevel + 1} началась. Шанс успеха ${chance}.` : `${title}. ${subtitle}.`

  return (
    <div className="enchant-button-wrap">
      <button type="button" className={`enchant-button ${stateClass}`} style={style} disabled={disabled} onClick={onClick} aria-label={`${title}. ${subtitle}`} aria-busy={busy || spinning}>
        <span className="enchant-button-fill" aria-hidden="true" />
        <span className="enchant-button-icon" aria-hidden="true">{spinning ? <span className="enchant-button-spinner" /> : <Icon name={icon} size={21} />}</span>
        <span className="enchant-button-copy">
          <span className="enchant-button-title">{title}</span>
          <span className="enchant-button-subtitle">{subtitle}</span>
        </span>
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
      {busy && <span className="visually-hidden" role="progressbar" aria-label="Прогресс заточки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)} />}
    </div>
  )
}
