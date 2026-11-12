import { useEffect, useRef, useState } from 'react'
import { MAX_ENCHANT } from '../lib/enchant'
import { ENCHANT_ATTEMPT_DURATION_MS, resolveEnchantAttempt } from '../lib/enchantAttempt'
import type { EnchantAttemptResult } from '../lib/enchantAttempt'

interface Options {
  level: number
  ready: boolean
  onLevelChange: (level: number) => void
}

interface RunningAttempt {
  fromLevel: number
  startedAt: number
}

export function useEnchantAttempt({ level, ready, onLevelChange }: Options) {
  const [attempt, setAttempt] = useState<RunningAttempt | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<EnchantAttemptResult | null>(null)
  const [feedback, setFeedback] = useState(false)
  // Block repeated clicks immediately, including clicks in one event batch.
  const activeAttempt = useRef<RunningAttempt | null>(null)

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
      setFeedback(true)
      onLevelChange(outcome.level)
    }, 50)
    return () => window.clearInterval(timer)
  }, [attempt, level, onLevelChange, ready])

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(false), 1000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  function start() {
    if (!ready || level >= MAX_ENCHANT || feedback || attempt || activeAttempt.current) return
    const next = { fromLevel: level, startedAt: performance.now() }
    activeAttempt.current = next
    setResult(null)
    setProgress(0)
    setAttempt(next)
  }

  function reset() {
    if (!ready || feedback || attempt || activeAttempt.current) return
    setResult(null)
    setProgress(0)
    onLevelChange(0)
  }

  return {
    attempt, progress, result: result?.level === level ? result : null, feedback,
    busy: attempt !== null,
    blocked: attempt !== null || feedback,
    start, reset,
  }
}

export type EnchantProcess = ReturnType<typeof useEnchantAttempt>
