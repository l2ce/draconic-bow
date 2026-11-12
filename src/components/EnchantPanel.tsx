import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { MAX_ENCHANT } from '../lib/enchant'
import type { EnchantState } from '../lib/enchant'
import { ENCHANT_ATTEMPT_DURATION_MS, getEnchantSuccessChance, resolveEnchantAttempt } from '../lib/enchantAttempt'
import type { EnchantAttemptResult } from '../lib/enchantAttempt'
import { Icon } from './Icon'

interface Props {
  state: EnchantState
  level: number
  modelReady: boolean
  onLevelChange: (level: number) => void
  onRetry: () => void
}

interface RunningAttempt {
  fromLevel: number
  startedAt: number
}

const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 })

export function EnchantPanel({ state, level, modelReady, onLevelChange, onRetry }: Props) {
  const [attempt, setAttempt] = useState<RunningAttempt | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<EnchantAttemptResult | null>(null)
  // State disables the UI; the ref also blocks repeated clicks in the same event batch.
  const activeAttempt = useRef<RunningAttempt | null>(null)
  const ready = modelReady && state.state === 'ready'
  const atMaximum = level >= MAX_ENCHANT
  const busy = attempt !== null

  useEffect(() => () => { activeAttempt.current = null }, [])

  useEffect(() => {
    if (!attempt) return
    const timer = window.setInterval(() => {
      if (activeAttempt.current !== attempt) return
      if (!ready || level !== attempt.fromLevel) {
        activeAttempt.current = null
        setAttempt(null)
        setProgress(0)
        return
      }
      const elapsed = performance.now() - attempt.startedAt
      if (elapsed < ENCHANT_ATTEMPT_DURATION_MS) {
        setProgress(Math.min(99, elapsed / ENCHANT_ATTEMPT_DURATION_MS * 100))
        return
      }
      const outcome = resolveEnchantAttempt(attempt.fromLevel)
      activeAttempt.current = null
      setAttempt(null)
      setProgress(100)
      setResult(outcome)
      onLevelChange(outcome.level)
    }, 50)
    return () => window.clearInterval(timer)
  }, [attempt, level, onLevelChange, ready])

  function startEnchant() {
    if (!ready || atMaximum || attempt || activeAttempt.current) return
    const next = { fromLevel: level, startedAt: performance.now() }
    activeAttempt.current = next
    setResult(null)
    setProgress(0)
    setAttempt(next)
  }

  function resetEnchant() {
    if (!ready || attempt || activeAttempt.current) return
    setResult(null)
    setProgress(0)
    onLevelChange(0)
  }

  const sourceLevel = state.state === 'ready' ? state.levels[level] : null
  const style = {
    '--enchant-color': state.state === 'ready' && sourceLevel && level >= state.meshStart
      ? `rgb(${sourceLevel.color1.join(' ')})` : 'var(--accent)',
  } as CSSProperties
  const hint = state.state === 'loading' ? 'Загружаем эффект из клиента…'
    : state.state === 'error' ? state.message
    : level < state.meshStart ? `До +${state.meshStart - 1} — без свечения, как в клиенте`
    : level < state.particlesStart ? `Аура оружия · частицы с +${state.particlesStart}`
    : atMaximum ? 'Максимальный уровень · красное свечение' : 'Аура и частицы'
  const status = !ready ? 'Ожидаем готовности сцены'
    : attempt ? `Заточка +${attempt.fromLevel} → +${attempt.fromLevel + 1}…`
    : result ? result.success ? `Успех! Оружие заточено до +${result.level}.` : `Неудача на +${result.fromLevel + 1}. Заточка сброшена в +0.`
    : 'До +3 заточка всегда успешна.'
  const outcomeClass = ready && result ? result.success ? 'is-success' : 'is-failure' : ''

  return (
    <section className={`enchant-panel ${state.state === 'error' ? 'has-error' : ''} ${busy ? 'is-enchanting' : ''} ${outcomeClass}`} style={style} aria-label="Заточка оружия" aria-busy={state.state === 'loading' || busy}>
      <div className="enchant-summary">
        <div className="enchant-heading"><span>ЗАТОЧКА ОРУЖИЯ</span><h1>Draconic Bow</h1></div>
        <output className="enchant-counter" aria-label="Уровень заточки" aria-live="polite">+{level}</output>
      </div>
      <p className="enchant-hint" role={state.state === 'error' ? 'alert' : undefined}>{hint}</p>
      <div className="enchant-chance" title="Шкала симуляции: до +3 — 100%, затем линейное снижение до 10% на попытке +15 → +16.">
        <span>{atMaximum ? 'Максимальный уровень' : `Попытка +${level} → +${level + 1}`}</span>
        <strong>{atMaximum ? '+16' : `Шанс ${percent.format(getEnchantSuccessChance(level))}`}</strong>
      </div>
      <div className="enchant-operation">
        <div className="enchant-operation-status">
          <span role="status" aria-live="polite">{status}</span>
          {busy && <span className="enchant-percentage" aria-hidden="true">{Math.floor(progress)}%</span>}
        </div>
        <div className="enchant-progress" role={busy ? 'progressbar' : undefined} aria-label={busy ? 'Прогресс заточки' : undefined} aria-valuemin={busy ? 0 : undefined} aria-valuemax={busy ? 100 : undefined} aria-valuenow={busy ? Math.floor(progress) : undefined}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="enchant-actions">
        {state.state === 'error' ? <button className="enchant-increase" disabled={busy} onClick={onRetry}>Загрузить повторно</button>
          : <button className="enchant-increase" disabled={!ready || busy || atMaximum} onClick={startEnchant} aria-label="Заточить оружие на +1"><Icon name={atMaximum ? 'check' : 'plus'} size={16} />{busy ? 'Заточка…' : atMaximum ? 'Максимум +16' : 'Заточить +1'}</button>}
        <button className="enchant-reset" disabled={!ready || busy || level === 0} onClick={resetEnchant} aria-label="Сбросить заточку" title="Сбросить заточку в +0"><Icon name="reset" size={16} /><span>Сбросить</span></button>
      </div>
      <p className="enchant-source">ПРИ НЕУДАЧЕ — +0 · ПРЕДЕЛ +16</p>
    </section>
  )
}
