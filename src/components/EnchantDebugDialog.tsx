import { useEffect, useRef } from 'react'
import { MAX_ENCHANT } from '../lib/enchant'

interface Props {
  level: number
  ready: boolean
  onApply: (level: number) => void
}

export function EnchantDebugDialog({ level, ready, onApply }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.code !== 'KeyM' || !event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      const modal = dialog.current
      const field = input.current
      if (!modal || !field) return
      if (modal.open) {
        modal.close()
        return
      }
      field.value = String(level)
      modal.showModal()
      field.focus()
      field.select()
    }
    window.addEventListener('keydown', onShortcut, true)
    return () => window.removeEventListener('keydown', onShortcut, true)
  }, [level])

  return (
    <dialog className="enchant-debug-dialog" ref={dialog} aria-labelledby="enchant-debug-title" aria-describedby="enchant-debug-description" onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
    }}>
      <form onSubmit={(event) => {
        event.preventDefault()
        const value = input.current?.valueAsNumber
        if (!ready || value === undefined || !Number.isInteger(value) || value < 0 || value > MAX_ENCHANT) return
        onApply(value)
        dialog.current?.close()
      }}>
        <h2 id="enchant-debug-title">Отладка заточки</h2>
        <p id="enchant-debug-description">Текущий уровень: +{level}. Применение сразу задаёт уровень и отменяет текущую попытку.</p>
        <label htmlFor="enchant-debug-level">Уровень заточки</label>
        <input ref={input} id="enchant-debug-level" name="level" type="number" inputMode="numeric" min={0} max={MAX_ENCHANT} step={1} required defaultValue={level} aria-describedby="enchant-debug-hint" />
        <p id="enchant-debug-hint" className="enchant-debug-hint">Целое число от 0 до {MAX_ENCHANT}.</p>
        {!ready && <p role="status">Для применения нужны загруженные модель и эффект.</p>}
        <div className="enchant-debug-actions">
          <button type="button" onClick={() => dialog.current?.close()}>Отмена</button>
          <button type="submit" className="enchant-debug-apply" disabled={!ready}>Применить</button>
        </div>
      </form>
    </dialog>
  )
}
