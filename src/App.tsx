import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './components/Icon'
import { ModelViewer } from './components/ModelViewer'
import { EnchantControls } from './components/EnchantControls'
import type { ViewerHandle } from './components/ModelViewer'
import { formatNumber } from './lib/models'
import type { ModelInfo } from './lib/models'
import type { CharacterAnimation, ViewerOptions } from './viewer/ViewerEngine'
import { clampEnchant } from './lib/enchant'
import type { EnchantState } from './lib/enchant'
import { ENCHANT_STUDY_LABELS, getEnchantStudyMode } from './lib/enchantStudy'
import { publicAssetUrl } from './lib/publicAsset'

const MODEL_URL = publicAssetUrl('models/human-female-plated-draconic.glb')
const animations: { id: CharacterAnimation; label: string; number: string }[] = [
  { id: 'idle', label: 'Стойка', number: '01' },
  { id: 'walk', label: 'Ходьба', number: '02' },
  { id: 'run', label: 'Бег', number: '03' },
]

export default function App() {
  const studyMode = getEnchantStudyMode()
  const viewer = useRef<ViewerHandle>(null)
  const fullscreen = useRef<HTMLElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [enchant, setEnchant] = useState<EnchantState>({ state: 'loading' })
  const [options, setOptions] = useState<ViewerOptions>(() => ({
    autoRotate: false,
    showGrid: true,
    wireframe: false,
    playAnimation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    animation: 'idle',
    enchantLevel: 0,
  }))

  useEffect(() => {
    const controller = new AbortController()
    async function loadCharacter() {
      try {
        const response = await fetch(MODEL_URL, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(response.status === 404
            ? 'Модель ещё не экспортирована. Сначала выполните сборку персонажа в Blender.'
            : `Не удалось получить модель: HTTP ${response.status}.`)
        }
        const buffer = await response.arrayBuffer()
        if (!controller.signal.aborted) {
          setFile(new File([buffer], 'human-female-plated-draconic.glb', { type: 'model/gltf-binary' }))
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Не удалось загрузить модель.')
      }
    }
    void loadCharacter()
    return () => controller.abort()
  }, [])

  const onLoaded = useCallback((model: ModelInfo) => {
    setInfo(model)
    setError(null)
  }, [])
  const onError = useCallback((message: string) => setError(message), [])
  const onEnchantState = useCallback((state: EnchantState) => {
    setEnchant(state)
    if (state.state === 'error') setOptions((current) => ({ ...current, enchantLevel: 0 }))
  }, [])

  const setEnchantLevel = useCallback((level: number) => {
    setOptions((current) => ({ ...current, enchantLevel: clampEnchant(level) }))
  }, [])
  const retryEnchant = useCallback(() => viewer.current?.retryEnchant(), [])

  function toggle(key: 'autoRotate' | 'showGrid' | 'wireframe' | 'playAnimation') {
    setOptions((current) => ({ ...current, [key]: !current[key] }))
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await fullscreen.current?.requestFullscreen()
    } catch {
      setNotice('Полноэкранный режим недоступен в этом браузере.')
    }
  }

  return (
    <main className="atelier" ref={fullscreen}>
      <div className="scene-background" aria-hidden="true" />
      <ModelViewer ref={viewer} file={file} options={options} onLoaded={onLoaded} onError={onError} onEnchantState={onEnchantState} />
      <div className="scene-vignette" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Draconic Bow — главная сцена">
          <span className="brand-mark"><Icon name="bow" size={29} /></span>
          <span><span className="brand-title">DRACONIC BOW</span><span className="brand-subtitle">LINEAGE II · HIGH FIVE</span></span>
        </a>
        <div className="scene-settings">
          <button className={`settings-trigger ${settingsOpen ? 'is-active' : ''}`} onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen} aria-controls="display-settings">
            <Icon name="layers" size={17} /> Отображение <span>{settingsOpen ? '−' : '+'}</span>
          </button>
          {settingsOpen && (
            <div className="settings-panel" id="display-settings">
              {([
                ['autoRotate', 'Автовращение'],
                ['showGrid', 'Сетка сцены'],
                ['wireframe', 'Каркас модели'],
              ] as const).map(([key, label]) => (
                <button className="setting-row" key={key} role="switch" aria-checked={options[key]} onClick={() => toggle(key)}>
                  {label}<span className={`switch ${options[key] ? 'is-on' : ''}`}><span /></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {studyMode && <div className="enchant-study-banner" role="status">Диагностика: {ENCHANT_STUDY_LABELS[studyMode]} · статичный кадр <a href={import.meta.env.BASE_URL}>Обычный просмотр</a></div>}

      <EnchantControls state={enchant} level={options.enchantLevel} modelReady={Boolean(info) && !error} onLevelChange={setEnchantLevel} onRetry={retryEnchant} />

      {(!info || error) && (
        <div className="scene-message" role={error ? 'alert' : 'status'} aria-live="polite">
          {error ? <Icon name="cube" size={32} /> : <span className="loading-ring" />}
          <h2>{error ? 'Сцена пока недоступна' : 'Собираем образ'}</h2>
          <p>{error ?? 'Загружаем геометрию, текстуры и анимации персонажа.'}</p>
          {error && <button className="text-button" onClick={() => window.location.reload()}>Попробовать снова <Icon name="arrow" size={16} /></button>}
        </div>
      )}

      <nav className="camera-tools" aria-label="Управление камерой">
        <button className="tool-button" onClick={() => viewer.current?.zoom(0.8)} aria-label="Приблизить" title="Приблизить"><Icon name="plus" /></button>
        <button className="tool-button" onClick={() => viewer.current?.zoom(1.25)} aria-label="Отдалить" title="Отдалить"><Icon name="minus" /></button>
        <span className="tools-divider" />
        <button className="tool-button" onClick={() => viewer.current?.resetView()} aria-label="Сбросить камеру" title="Сбросить камеру"><Icon name="reset" /></button>
        <button className="tool-button" onClick={toggleFullscreen} aria-label="На весь экран" title="На весь экран"><Icon name="expand" /></button>
      </nav>

      <footer className="scene-footer">
        <div className="camera-hints"><Icon name="mouse" size={18} /><span>Тяните, чтобы вращать<br /><span>Колесо — приближение</span></span></div>
        <div className="animation-console" aria-label="Анимации персонажа">
          <div className="animation-label">ДВИЖЕНИЕ <span>НА МЕСТЕ</span></div>
          <div className="animation-controls">
            {animations.map((animation) => (
              <button key={animation.id} className={`animation-button ${options.animation === animation.id ? 'is-active' : ''}`} disabled={!info?.animationNames.includes(animation.id)} aria-pressed={options.animation === animation.id} onClick={() => setOptions((current) => ({ ...current, animation: animation.id }))}>
                <span>{animation.number}</span>{animation.label}
              </button>
            ))}
            <button className="pause-button" disabled={!info?.animations} aria-label={options.playAnimation ? 'Приостановить анимацию' : 'Продолжить анимацию'} title={options.playAnimation ? 'Пауза' : 'Продолжить'} onClick={() => toggle('playAnimation')}>
              {options.playAnimation ? <span className="pause-symbol" /> : <span className="play-symbol" />}
            </button>
          </div>
        </div>
        <div className="scene-metrics">{info ? <><span>{formatNumber(info.triangles)} треугольников</span><span>{info.bones} костей · {info.animationNames.length} анимации</span></> : <><span>КРУГОВОЙ ОБЗОР</span><span>360°</span></>}</div>
      </footer>

      {notice && <div className="notice" role="status">{notice}<button aria-label="Закрыть уведомление" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
    </main>
  )
}
