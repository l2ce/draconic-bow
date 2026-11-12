import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  CircleGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  LoadingManager,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  RingGeometry,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { AnimationAction, AnimationClip, WebGLRenderTarget } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { disposeObject, inspectModel, validateEmbeddedGlb, validateModelFile } from '../lib/models'
import type { ModelInfo } from '../lib/models'
import type { EnchantState } from '../lib/enchant'
import { WeaponEnchant } from './WeaponEnchant'
import { getEnchantStudyMode } from '../lib/enchantStudy'
import { MotionDiagnostics } from './MotionDiagnostics'
import { applyNativeBowMaterial } from '../lib/bowMaterial'

export interface ViewerOptions {
  autoRotate: boolean
  showGrid: boolean
  wireframe: boolean
  playAnimation: boolean
  animation: CharacterAnimation
  enchantLevel: number
}

export type CameraView = 'front' | 'side' | 'back'
export type CharacterAnimation = 'idle' | 'walk' | 'run'

export class ViewerEngine {
  private readonly renderer: WebGLRenderer
  private readonly motionDiagnostics: MotionDiagnostics | null
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(36, 1, 0.01, 200)
  private readonly controls: OrbitControls
  private readonly resizeObserver: ResizeObserver
  private readonly environment: WebGLRenderTarget
  private readonly stage = new Group()
  private readonly loader: GLTFLoader
  private model: Group | null = null
  private mixer: AnimationMixer | null = null
  private clips: AnimationClip[] = []
  private activeAction: AnimationAction | null = null
  private bounds = new Sphere(new Vector3(0, 1.2, 0), 1.7)
  private options: ViewerOptions
  private generation = 0
  private disposed = false
  private lastFrame = 0
  private readonly studyMode = getEnchantStudyMode()
  private enchantment: WeaponEnchant | null = null
  private enchantAbort: AbortController | null = null
  private weapon: Mesh | null = null

  constructor(
    private readonly container: HTMLElement,
    options: ViewerOptions,
    private readonly onFatalError: (message: string) => void,
    private readonly onEnchantState: (state: EnchantState) => void,
  ) {
    this.options = options
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.renderer.domElement.setAttribute('aria-label', '3D-сцена: вращайте модель мышью или касанием')
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
    container.append(this.renderer.domElement)
    this.motionDiagnostics = MotionDiagnostics.create(container, this.renderer.getContext())

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotateSpeed = 0.75
    this.controls.maxPolarAngle = Math.PI * 0.91
    this.controls.minPolarAngle = Math.PI * 0.04

    const room = new RoomEnvironment()
    const pmrem = new PMREMGenerator(this.renderer)
    this.environment = pmrem.fromScene(room, 0.04)
    this.scene.environment = this.environment.texture
    this.scene.environmentIntensity = 0.55
    room.dispose()
    pmrem.dispose()

    this.scene.add(new AmbientLight(0xd5e0dd, 0.7))
    const key = new DirectionalLight(0xffedd4, 3)
    key.position.set(4, 7, 5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -5
    key.shadow.camera.right = 5
    key.shadow.camera.top = 5
    key.shadow.camera.bottom = -5
    key.shadow.normalBias = 0.02
    this.scene.add(key)
    const rim = new DirectionalLight(0x92bdb7, 2.5)
    rim.position.set(-4, 3, -4)
    this.scene.add(rim)
    this.createStage()

    const manager = new LoadingManager()
    manager.setURLModifier((url) => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url
      throw new Error('Внешние ресурсы заблокированы. Экспортируйте GLB со встроенными текстурами.')
    })
    this.loader = new GLTFLoader(manager)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)
    this.resize()
    this.resetView()
    this.setOptions(options)
    this.renderer.setAnimationLoop(this.render)
  }

  private createStage(): void {
    const floor = new Mesh(
      new CircleGeometry(5, 96),
      new MeshStandardMaterial({ color: 0x282a2f, roughness: 0.95, metalness: 0.05, transparent: true, opacity: 0.65 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.02
    floor.receiveShadow = true
    this.stage.add(floor)

    const grid = new GridHelper(10, 20, 0x666a73, 0x3d4148)
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
    for (const material of materials) {
      material.transparent = true
      material.opacity = 0.25
      material.depthWrite = false
    }
    this.stage.add(grid)

    for (const radius of [1.8, 1.86, 3.4]) {
      const ring = new Mesh(
        new RingGeometry(radius, radius + 0.008, 128),
        new MeshBasicMaterial({ color: 0x9ba3b0, transparent: true, opacity: radius > 2 ? 0.12 : 0.3, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.003
      this.stage.add(ring)
    }
    this.scene.add(this.stage)
  }

  private readonly resize = (): void => {
    if (this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    if (width <= 700) this.camera.setViewOffset(width, height, 0, 55, width, height)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private readonly render = (time: number): void => {
    if (this.disposed || document.hidden) {
      this.lastFrame = time
      return
    }
    const delta = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.1) : 0
    this.lastFrame = time
    this.controls.update(delta)
    const animationUpdated = Boolean(this.options.playAnimation && !this.studyMode && this.mixer)
    if (animationUpdated) this.mixer?.update(delta)
    this.enchantment?.update(delta, this.camera)
    this.renderer.render(this.scene, this.camera)
    this.motionDiagnostics?.sample(time, {
      clip: this.activeAction?.getClip() ?? null,
      animationUpdated,
      speed: (this.activeAction?.getEffectiveTimeScale() ?? 1) * (this.mixer?.timeScale ?? 1),
      staticStudy: Boolean(this.studyMode),
    })
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault()
    this.renderer.setAnimationLoop(null)
    this.onFatalError('Браузер потерял доступ к GPU. Перезагрузите страницу, чтобы восстановить 3D-сцену.')
  }

  setOptions(options: ViewerOptions): void {
    const animationChanged = this.options.animation !== options.animation
    this.options = options
    this.controls.autoRotate = options.autoRotate && this.model !== null
    this.stage.visible = options.showGrid
    this.model?.traverse((object) => {
      if (!(object instanceof Mesh) || object.userData.viewerEffect) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if ('wireframe' in material) material.wireframe = options.wireframe
      }
    })
    if (animationChanged) this.setAnimation(options.animation)
    this.enchantment?.setLevel(options.enchantLevel)
    this.enchantment?.setWireframe(options.wireframe)
  }

  private setAnimation(name: CharacterAnimation): void {
    if (!this.mixer) return
    const clip = this.clips.find((clip) => clip.name === name) ?? this.clips.find((clip) => clip.name === 'idle') ?? this.clips[0]
    if (!clip) return
    const next = this.mixer.clipAction(clip)
    if (next === this.activeAction) return
    this.activeAction?.fadeOut(0.25)
    next.reset().fadeIn(0.25).play()
    this.activeAction = next
  }

  async load(file: File): Promise<ModelInfo | null> {
    const request = ++this.generation
    const fileError = validateModelFile(file)
    if (fileError) throw new Error(fileError)
    const data = await file.arrayBuffer()
    if (this.disposed || request !== this.generation) return null
    validateEmbeddedGlb(data)

    const gltf = await this.loader.parseAsync(data, '')
    if (this.disposed || request !== this.generation) {
      disposeObject(gltf.scene)
      return null
    }

    const weapon = gltf.scene.getObjectByName('bow')
    if (weapon instanceof Mesh && this.studyMode !== 'bow-blend' && this.studyMode !== 'before') applyNativeBowMaterial(weapon)
    const info = inspectModel(gltf.scene, gltf.animations, file)
    const box = new Box3().setFromObject(gltf.scene)
    const size = box.getSize(new Vector3())
    const extent = Math.max(size.x, size.y, size.z)
    if (!info.meshes || box.isEmpty() || !Number.isFinite(extent) || extent <= 0) {
      disposeObject(gltf.scene)
      throw new Error('В GLB нет видимой геометрии. Включите нужные меши при экспорте из Blender.')
    }

    this.removeModel()
    const center = box.getCenter(new Vector3())
    const scale = 3 / extent
    this.model = new Group()
    this.model.add(gltf.scene)
    this.model.scale.setScalar(scale)
    this.model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
    gltf.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    this.scene.add(this.model)
    this.model.updateMatrixWorld(true)
    this.bounds = new Box3().setFromObject(this.model).getBoundingSphere(new Sphere())

    this.clips = gltf.animations
    if (this.clips.length) {
      this.mixer = new AnimationMixer(gltf.scene)
      this.setAnimation(this.options.animation)
      if (this.studyMode) this.mixer.setTime(0.5)
    }
    this.setOptions(this.options)
    this.resetView()
    if (this.studyMode) {
      const view = new URLSearchParams(window.location.search).get('studyView')
      if (view !== 'quarter') this.setView(view === 'front' || view === 'back' ? view : 'side')
    }
    this.weapon = weapon instanceof Mesh ? weapon : null
    void this.loadEnchantEffect(request)
    return info
  }

  private async loadEnchantEffect(request: number): Promise<void> {
    this.enchantAbort?.abort()
    this.enchantment?.dispose()
    this.enchantment = null
    const weapon = this.weapon
    if (!weapon) {
      this.onEnchantState({ state: 'error', message: 'В модели не найден Draconic Bow. Заточка недоступна.' })
      return
    }
    const controller = new AbortController()
    this.enchantAbort = controller
    this.onEnchantState({ state: 'loading' })
    try {
      const effect = await WeaponEnchant.create(weapon, controller.signal)
      if (this.disposed || controller.signal.aborted || request !== this.generation || weapon !== this.weapon) {
        effect.dispose()
        return
      }
      this.enchantment = effect
      effect.setLevel(this.options.enchantLevel)
      effect.setWireframe(this.options.wireframe)
      this.onEnchantState({
        state: 'ready', meshStart: effect.config.meshStart,
        particlesStart: effect.config.particlesStart, levels: effect.config.levels,
      })
    } catch (error) {
      if (this.disposed || controller.signal.aborted || request !== this.generation) return
      this.onEnchantState({ state: 'error', message: error instanceof Error ? error.message : 'Не удалось подготовить эффект заточки.' })
    }
  }

  retryEnchant(): void {
    if (!this.disposed && this.model) void this.loadEnchantEffect(this.generation)
  }

  resetView(): void {
    let box = new Box3().setFromCenterAndSize(this.bounds.center, new Vector3(2, 2.4, 1.5))
    if (this.model) {
      this.scene.updateMatrixWorld(true)
      box = new Box3()
      const point = new Vector3()
      // Do not let particles or the glow shell change the camera framing.
      this.model.traverse((object) => {
        if (!(object instanceof Mesh) || object.userData.viewerEffect) return
        const count = object.geometry.getAttribute('position')?.count ?? 0
        for (let index = 0; index < count; index += 1) {
          object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld)
          box.expandByPoint(point)
        }
      })
      this.bounds = box.getBoundingSphere(new Sphere())
    }
    const verticalFov = MathUtils.degToRad(this.camera.fov)
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect)
    const height = this.container.clientHeight
    const usableHeight = Math.max(0.45, (height - (this.container.clientWidth <= 700 ? 270 : 200)) / height)
    const usableWidth = this.container.clientWidth <= 700 ? 0.78 : 0.75
    const direction = new Vector3(1.2, 0.65, 1.9).normalize()
    this.camera.position.copy(direction.clone().add(this.bounds.center))
    this.camera.lookAt(this.bounds.center)
    const viewRotation = this.camera.quaternion.clone().invert()
    let distance = 0
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const point = new Vector3(x, y, z).sub(this.bounds.center).applyQuaternion(viewRotation)
          distance = Math.max(
            distance,
            point.z + Math.abs(point.x) / (Math.tan(horizontalFov / 2) * usableWidth),
            point.z + Math.abs(point.y) / (Math.tan(verticalFov / 2) * usableHeight),
          )
        }
      }
    }
    this.controls.target.copy(this.bounds.center)
    this.camera.position.copy(direction.multiplyScalar(distance * 1.05).add(this.bounds.center))
    this.controls.minDistance = this.bounds.radius * 0.25
    this.controls.maxDistance = Math.max(distance * 3, this.bounds.radius * 10)
    this.camera.near = Math.max(0.001, this.bounds.radius / 100)
    this.camera.far = this.controls.maxDistance * 4
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  setView(view: CameraView): void {
    const directions = { front: new Vector3(0, 0.12, 1), side: new Vector3(1, 0.12, 0), back: new Vector3(0, 0.12, -1) }
    const distance = this.camera.position.distanceTo(this.controls.target)
    this.camera.position.copy(directions[view].normalize().multiplyScalar(distance).add(this.controls.target))
    this.controls.update()
  }

  zoom(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance)
    this.camera.position.copy(offset.setLength(distance).add(this.controls.target))
    this.controls.update()
  }

  clear(): void {
    this.generation += 1
    this.removeModel()
    this.controls.autoRotate = false
    this.bounds = new Sphere(new Vector3(0, 1.2, 0), 1.7)
    this.resetView()
  }

  private removeModel(): void {
    this.enchantAbort?.abort()
    this.enchantAbort = null
    this.enchantment?.dispose()
    this.enchantment = null
    this.weapon = null
    if (!this.model) return
    this.mixer?.stopAllAction()
    if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot())
    this.mixer = null
    this.clips = []
    this.activeAction = null
    disposeObject(this.model)
    this.model = null
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.motionDiagnostics?.dispose()
    this.removeModel()
    disposeObject(this.scene)
    this.environment.dispose()
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
