import { useEnchantAttempt } from '../hooks/useEnchantAttempt'
import type { EnchantState } from '../lib/enchant'
import { getEnchantSuccessChance } from '../lib/enchantAttempt'
import { EnchantButton } from './EnchantButton'
import { EnchantDebugDialog } from './EnchantDebugDialog'

interface Props {
  state: EnchantState
  level: number
  modelReady: boolean
  onLevelChange: (level: number) => void
  onRetry: () => void
}

const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 })

export function EnchantControls({ state, level, modelReady, onLevelChange, onRetry }: Props) {
  const ready = modelReady && state.state === 'ready'
  const process = useEnchantAttempt({ level, ready, onLevelChange })
  const chance = percent.format(getEnchantSuccessChance(level))
  return (
    <div className="enchant-controls">
      <EnchantButton state={state} level={level} ready={ready} chance={chance} process={process} onRetry={onRetry} />
      <EnchantDebugDialog level={level} ready={ready} onApply={process.overrideLevel} />
    </div>
  )
}
