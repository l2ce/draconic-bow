import { useEffect, useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'
import { ViewerEngine } from '../viewer/ViewerEngine'
import type { CameraView, ViewerOptions } from '../viewer/ViewerEngine'
import type { ModelInfo } from '../lib/models'
import type { EnchantState } from '../lib/enchant'

export interface ViewerHandle {
  resetView: () => void
  setView: (view: CameraView) => void
  zoom: (factor: number) => void
  retryEnchant: () => void
}

interface Props {
  ref: Ref<ViewerHandle>
  file: File | null
  options: ViewerOptions
  onReady: () => void
  onLoaded: (info: ModelInfo) => void
  onError: (message: string) => void
  onEnchantState: (state: EnchantState) => void
}

export function ModelViewer({ ref, file, options, onReady, onLoaded, onError, onEnchantState }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const engine = useRef<ViewerEngine | null>(null)
  const initialOptions = useRef(options)

  useImperativeHandle(ref, () => ({
    resetView: () => engine.current?.resetView(),
    setView: (view) => engine.current?.setView(view),
    zoom: (factor) => engine.current?.zoom(factor),
    retryEnchant: () => engine.current?.retryEnchant(),
  }), [])

  useEffect(() => {
    if (!container.current) return
    try {
      engine.current = new ViewerEngine(container.current, initialOptions.current, onError, onEnchantState)
      onReady()
    } catch (error) {
      console.error('Не удалось создать 3D-сцену:', error)
      onError('3D-сцена недоступна. Нужен браузер с WebGL 2 и включённым аппаратным ускорением.')
    }
    return () => {
      engine.current?.dispose()
      engine.current = null
    }
  }, [onReady, onError, onEnchantState])

  useEffect(() => {
    engine.current?.setOptions(options)
  }, [options])

  useEffect(() => {
    if (!file) {
      engine.current?.clear()
      return
    }
    let cancelled = false
    engine.current?.load(file).then((info) => {
      if (!cancelled && info) onLoaded(info)
    }).catch((error: unknown) => {
      if (cancelled) return
      console.error('Не удалось загрузить GLB:', error)
      onError(error instanceof Error ? error.message : 'Не удалось открыть модель. Проверьте GLB-файл.')
    })
    return () => { cancelled = true }
  }, [file, onLoaded, onError])

  return <div className="three-canvas" ref={container} />
}
