import {
  AddEquation, AlwaysStencilFunc, BufferGeometry, Color, CubeTextureLoader, CustomBlending, DoubleSide, DynamicDrawUsage,
  Euler, FrontSide, Group, InstancedBufferAttribute, InstancedMesh, Matrix3, Matrix4, Mesh,
  KeepStencilOp, NoBlending, NoColorSpace, NotEqualStencilFunc, OneFactor, OneMinusSrcAlphaFactor, OneMinusSrcColorFactor, PlaneGeometry, ReplaceStencilOp,
  Quaternion, ShaderMaterial, SRGBColorSpace, TextureLoader, Vector2, Vector3, Float32BufferAttribute,
} from 'three'
import type { CubeTexture, MeshStandardMaterial, PerspectiveCamera, Texture } from 'three'
import { clampEnchant, parseEnchantConfig } from '../lib/enchant'
import type { EnchantConfig, EnchantEmitter, EnchantLevel, NumberRange, Vec3Tuple } from '../lib/enchant'
import { getEnchantStudyMode } from '../lib/enchantStudy'
import { publicAssetUrl } from '../lib/publicAsset'

// Web exposure calibration against game references, not recovered UE2 parameters.
// The client still supplies every level's palette, opacity and particle density.
const AURA_GAIN = 2.4
const WEAPON_SHIMMER_GAIN = 0.6

// Unreal translucency is a screen blend, not an opaque recolor of the weapon.
const translucent = {
  transparent: true,
  depthWrite: false,
  toneMapped: false,
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcColorFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
}

const surfaceVertex = /* glsl */ `
  uniform float uExtrude;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  varying vec3 vWeaponPosition;
  varying vec2 vUv;
  void main() {
    vec4 view = modelViewMatrix * vec4(position + normal * uExtrude, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDirection = -view.xyz;
    vWeaponPosition = position;
    vUv = uv;
    gl_Position = projectionMatrix * view;
  }
`

const surfaceFragment = /* glsl */ `
  uniform samplerCube uAura;
  uniform sampler2D uMask;
  uniform bool uHasMask;
  uniform float uAlphaCutoff;
  uniform mat3 uRotation;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uGain;
  uniform vec3 uRangeCenter;
  uniform vec3 uRangeRadii;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  varying vec3 vWeaponPosition;
  varying vec2 vUv;
  void main() {
    float cutout = uHasMask ? texture2D(uMask, vUv).a : 1.0;
    if (cutout < uAlphaCutoff) discard;
    // The approved shimmer must not recolor limbs outside the actual aura volume.
    float radius = length((vWeaponPosition - uRangeCenter) / uRangeRadii);
    float influence = 1.0 - smoothstep(0.4, 0.95, radius);
    if (influence < 0.001) discard;
    vec3 reflected = reflect(-normalize(vViewDirection), normalize(vViewNormal));
    // The original environment map is camera-space; UE Z-up -> glTF Y-up.
    vec3 sourceDirection = vec3(reflected.x, reflected.z, reflected.y);
    vec3 aura = textureCube(uAura, uRotation * sourceDirection).rgb;
    vec3 color = aura * uTint * uOpacity * uGain * cutout * influence;
    gl_FragColor = vec4(color, clamp(max(max(color.r, color.g), color.b), 0.0, 1.0));
    #include <colorspace_fragment>
  }
`

// Rangesample uses a camera-space environment map. Camera coordinates must NOT
// be converted from world Z-up to Y-up: doing so moves the glow onto a hemisphere.
const rangeFragment = /* glsl */ `
  uniform samplerCube uAura;
  uniform mat3 uRotation;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uGain;
  uniform bool uLegacyComposite;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  void main() {
    vec3 normal = normalize(vViewNormal);
    vec3 view = normalize(vViewDirection);
    vec3 reflected = reflect(-view, normal);
    vec3 aura = textureCube(uAura, uRotation * reflected).rgb;
    float edge = smoothstep(0.0, 0.35, max(dot(normal, view), 0.0));
    vec3 color = aura * uTint * uOpacity * uGain * edge;
    gl_FragColor = vec4(color, clamp(max(max(color.r, color.g), color.b), 0.0, 1.0));
    #include <colorspace_fragment>
    if (!uLegacyComposite) {
      // The transparent canvas also needs alpha in the displayed-color domain.
      gl_FragColor.a = clamp(max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b), 0.0, 1.0);
    }
  }
`

const weaponMaskFragment = /* glsl */ `
  uniform sampler2D uMask;
  uniform bool uHasMask;
  uniform float uAlphaCutoff;
  varying vec2 vUv;
  void main() {
    if (uHasMask && texture2D(uMask, vUv).a < uAlphaCutoff) discard;
    // Normally colorWrite=false: this only protects the visible weapon silhouette.
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
  }
`

// Diagnostic alternative: use the source sphere as a bound, not a visible shell.
// The ray-to-center distance avoids the angular compression of a reflected cubemap.
const volumeFragment = /* glsl */ `
  uniform samplerCube uAura;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uGain;
  uniform vec3 uCameraLocal;
  uniform vec3 uSphereCenter;
  uniform float uSphereRadius;
  varying vec3 vWeaponPosition;
  void main() {
    vec3 origin = uCameraLocal - uSphereCenter;
    bool inside = length(origin) < uSphereRadius;
    if (inside ? gl_FrontFacing : !gl_FrontFacing) discard;
    vec3 ray = normalize(vWeaponPosition - uCameraLocal);
    vec3 nearest = origin + ray * max(0.0, -dot(origin, ray));
    float radius = length(nearest) / uSphereRadius;
    float boundary = 1.0 - smoothstep(0.60, 0.97, radius);
    if (boundary < 0.0001) discard;
    // -X is the original centered Gaussian face, sampled as intensity data.
    float profile = textureCube(uAura, vec3(-1.0, 0.0, radius)).r;
    // Optical falloff for the web volume: near-zero density well before the hull.
    // This is a reconstruction coefficient, not a recovered client parameter.
    float density = exp(-4.0 * radius * radius);
    vec3 color = uTint * profile * density * boundary * uOpacity * uGain;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.a = clamp(max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b), 0.0, 1.0);
  }
`

const detailEmissionFragment = /* glsl */ `
  uniform samplerCube uAura;
  uniform sampler2D uMask;
  uniform bool uHasMask;
  uniform float uAlphaCutoff;
  uniform mat3 uRotation;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uGain;
  uniform vec3 uRangeCenter;
  uniform vec3 uRangeRadii;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  varying vec3 vWeaponPosition;
  varying vec2 vUv;
  void main() {
    vec4 original = uHasMask ? texture2D(uMask, vUv) : vec4(1.0);
    if (original.a < uAlphaCutoff) discard;
    float radius = length((vWeaponPosition - uRangeCenter) / uRangeRadii);
    float influence = 1.0 - smoothstep(0.4, 0.95, radius);
    if (influence < 0.001) discard;
    vec3 reflected = reflect(-normalize(vViewDirection), normalize(vViewNormal));
    // Use the same camera-space reflection as the surrounding Rangesample aura.
    float shimmer = textureCube(uAura, uRotation * reflected).r;
    // Follow the original texture's highlights; leave dark recesses unlit.
    float detail = max(max(original.r, original.g), original.b);
    detail *= smoothstep(0.05, 0.65, detail);
    vec3 color = uTint * shimmer * detail * influence * uOpacity * uGain * original.a;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.a = clamp(max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b), 0.0, 1.0);
  }
`

const particleVertex = /* glsl */ `
  attribute float aFrame;
  attribute float aOpacity;
  attribute vec3 aTint;
  varying vec2 vUv;
  varying float vFrame;
  varying float vOpacity;
  varying vec3 vTint;
  void main() {
    vUv = uv;
    vFrame = aFrame;
    vOpacity = aOpacity;
    vTint = aTint;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const particleFragment = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uSubdivisions;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vFrame;
  varying float vOpacity;
  varying vec3 vTint;
  void main() {
    vec2 cell = vec2(mod(vFrame, uSubdivisions.x), floor(vFrame / uSubdivisions.x));
    vec3 flame = texture2D(uAtlas, (vUv + cell) / uSubdivisions).rgb;
    vec3 color = flame * uTint * vTint * vOpacity;
    gl_FragColor = vec4(color, clamp(max(max(color.r, color.g), color.b), 0.0, 1.0));
    #include <colorspace_fragment>
  }
`

interface Resources {
  config: EnchantConfig
  cube: CubeTexture
  textures: Map<string, Texture>
  rangeGeometry: BufferGeometry
}

async function loadRangeGeometry(url: string, signal: AbortSignal): Promise<BufferGeometry> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Не удалось загрузить исходный меш ауры оружия.')
  const data = await response.json() as Record<string, unknown>
  if (data.version !== 1 || data.source !== 'LineageWeapons.Rangesample' ||
    !Array.isArray(data.positions) || data.positions.length < 9 || data.positions.length > 300000 || data.positions.length % 3 ||
    !data.positions.every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1000) ||
    !Array.isArray(data.indices) || data.indices.length < 3 || data.indices.length > 300000 || data.indices.length % 3) {
    throw new Error('Повреждены данные исходного меша ауры.')
  }
  const vertexCount = data.positions.length / 3
  if (!data.indices.every((value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < vertexCount)) {
    throw new Error('Некорректные индексы меша ауры.')
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(vertexCount * 2), 2))
  geometry.setIndex(data.indices)
  geometry.computeBoundingSphere()
  const center = geometry.boundingSphere!.center
  const normal = new Vector3()
  const normals = new Float32Array(data.positions.length)
  for (let index = 0; index < vertexCount; index += 1) {
    normal.fromArray(data.positions, index * 3).sub(center).normalize().toArray(normals, index * 3)
  }
  // Rangesample is a geosphere. Radial normals avoid faceting from PSK's lost normals.
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  return geometry
}

async function loadResources(signal: AbortSignal): Promise<Resources> {
  const response = await fetch(publicAssetUrl('effects/enchant.json'), { signal })
  if (!response.ok) throw new Error('Не удалось загрузить параметры заточки из клиента.')
  const config = parseEnchantConfig(await response.json())
  const urls = [...new Set(config.emitters.map((emitter) => emitter.texture))]
  const results = await Promise.allSettled([
    new CubeTextureLoader().loadAsync(config.surface.faces.map(publicAssetUrl)),
    ...urls.map((url) => new TextureLoader().loadAsync(publicAssetUrl(url))),
    loadRangeGeometry(publicAssetUrl(config.range.geometry), signal),
  ])
  if (signal.aborted || results.some((result) => result.status === 'rejected')) {
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose()
    if (signal.aborted) throw new DOMException('Загрузка отменена', 'AbortError')
    throw new Error('Не удалось загрузить ресурсы свечения. Модель доступна без заточки.')
  }
  const studyMode = getEnchantStudyMode()
  const rawMaskStudy = studyMode === 'aura-data' || studyMode === 'volume' || studyMode === 'volume-full'
  const loaded = results.map((result, index) => {
    if (result.status !== 'fulfilled') throw new Error('Не удалось загрузить текстуру.')
    if (!(result.value instanceof BufferGeometry)) {
      // Raw-intensity import is an isolated diagnostic: it exposes the sphere hull.
      // Keep the established import in the normal view and the particle atlas unchanged.
      result.value.colorSpace = index === 0 && rawMaskStudy ? NoColorSpace : SRGBColorSpace
    }
    return result.value
  })
  return {
    config, cube: loaded[0] as CubeTexture,
    textures: new Map(urls.map((url, index) => [url, loaded[index + 1] as Texture])),
    rangeGeometry: loaded.at(-1) as BufferGeometry,
  }
}

function fromUnreal(vector: Vector3, source: Vec3Tuple): Vector3 {
  return vector.set(source[0], source[2], source[1])
}

function curveValue(curve: [number, number][], time: number): number {
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1]!
    const next = curve[index]!
    if (time <= next[0]) {
      const factor = Math.max(0, Math.min(1, (time - previous[0]) / Math.max(0.0001, next[0] - previous[0])))
      return previous[1] + (next[1] - previous[1]) * factor
    }
  }
  return curve.at(-1)?.[1] ?? 1
}

interface Particle {
  active: boolean
  age: number
  lifetime: number
  position: Vector3
  velocity: Vector3
  loss: Vector3
  size: Vector3
  tint: Vector3
  spin: number
  spinRate: number
  frame: number
}

class ParticleEmitter {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>
  private readonly particles: Particle[]
  private readonly opacity: InstancedBufferAttribute
  private readonly frames: InstancedBufferAttribute
  private readonly tints: InstancedBufferAttribute
  private readonly acceleration = new Vector3()
  private accumulator = 0
  private seed: number
  private readonly matrix = new Matrix4()
  private readonly rotation = new Quaternion()
  private readonly spin = new Quaternion()
  private readonly size = new Vector3()
  private readonly localCamera = new Quaternion()
  private readonly groupRotation = new Quaternion()
  private readonly cameraRight = new Vector3()
  private readonly cameraUp = new Vector3()
  private readonly worldVelocity = new Vector3()
  private readonly zAxis = new Vector3(0, 0, 1)

  constructor(private readonly source: EnchantEmitter, texture: Texture, tint: Vector3, seed: number) {
    this.seed = seed
    const geometry = new PlaneGeometry(1, 1)
    this.frames = new InstancedBufferAttribute(new Float32Array(source.maxParticles), 1)
    this.opacity = new InstancedBufferAttribute(new Float32Array(source.maxParticles), 1)
    this.tints = new InstancedBufferAttribute(new Float32Array(source.maxParticles * 3), 3)
    geometry.setAttribute('aFrame', this.frames)
    geometry.setAttribute('aOpacity', this.opacity)
    geometry.setAttribute('aTint', this.tints)
    const material = new ShaderMaterial({
      ...translucent, side: DoubleSide,
      uniforms: { uAtlas: { value: texture }, uSubdivisions: { value: new Vector2(...source.subdivisions) }, uTint: { value: tint } },
      vertexShader: particleVertex, fragmentShader: particleFragment,
    })
    this.mesh = new InstancedMesh(geometry, material, source.maxParticles)
    this.mesh.name = `enchant-${source.name}`
    this.mesh.userData.viewerEffect = true
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.particles = Array.from({ length: source.maxParticles }, () => ({
      active: false, age: 0, lifetime: 1, position: new Vector3(), velocity: new Vector3(),
      loss: new Vector3(), size: new Vector3(), tint: new Vector3(), spin: 0, spinRate: 0, frame: 0,
    }))
    fromUnreal(this.acceleration, source.acceleration)
  }

  private random(range: NumberRange): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return range[0] + (range[1] - range[0]) * this.seed / 4294967296
  }

  reset(): void {
    this.accumulator = 0
    for (const particle of this.particles) particle.active = false
  }

  advance(delta: number, density: number): void {
    const capacity = Math.max(1, Math.floor(this.source.maxParticles * density))
    for (const [index, particle] of this.particles.entries()) {
      if (index >= capacity) particle.active = false
      if (!particle.active) continue
      particle.age += delta
      if (particle.age >= particle.lifetime) { particle.active = false; continue }
      particle.velocity.addScaledVector(this.acceleration, delta)
      particle.velocity.multiply(this.size.set(Math.exp(-particle.loss.x * delta), Math.exp(-particle.loss.y * delta), Math.exp(-particle.loss.z * delta)))
      particle.position.addScaledVector(particle.velocity, delta)
    }
    this.accumulator = Math.min(capacity, this.accumulator + delta * this.source.rate * density)
    while (this.accumulator >= 1) {
      const particle = this.particles.slice(0, capacity).find((particle) => !particle.active)
      if (!particle) break
      this.accumulator -= 1
      particle.active = true
      particle.age = 0
      particle.lifetime = this.random(this.source.lifetime)
      fromUnreal(particle.position, this.source.offset)
      particle.position.add(this.size.set(this.random(this.source.locationRange[0]), this.random(this.source.locationRange[2]), this.random(this.source.locationRange[1])))
      particle.velocity.set(this.random(this.source.velocityRange[0]), this.random(this.source.velocityRange[2]), this.random(this.source.velocityRange[1]))
      particle.loss.set(this.random(this.source.velocityLossRange[0]), this.random(this.source.velocityLossRange[2]), this.random(this.source.velocityLossRange[1]))
      particle.size.set(this.random(this.source.sizeRange[0]), this.random(this.source.sizeRange[1]), 1)
      particle.tint.set(this.random(this.source.colorMultiplier[0]), this.random(this.source.colorMultiplier[1]), this.random(this.source.colorMultiplier[2]))
      particle.spin = this.random(this.source.startSpin) * Math.PI * 2
      particle.spinRate = this.random(this.source.spinRate) * Math.PI * 2
      particle.frame = Math.floor(this.random([0, this.source.lastFrame + 1]))
    }
  }

  updateMatrices(parent: Group, camera: PerspectiveCamera, level: EnchantLevel): void {
    parent.getWorldQuaternion(this.groupRotation)
    camera.getWorldQuaternion(this.localCamera)
    this.cameraRight.set(1, 0, 0).applyQuaternion(this.localCamera)
    this.cameraUp.set(0, 1, 0).applyQuaternion(this.localCamera)
    this.localCamera.premultiply(this.groupRotation.clone().invert())
    for (const [index, particle] of this.particles.entries()) {
      if (!particle.active) {
        this.matrix.makeScale(0, 0, 0)
        this.mesh.setMatrixAt(index, this.matrix)
        this.opacity.setX(index, 0)
        continue
      }
      const normalizedAge = particle.age / particle.lifetime
      const growth = curveValue(this.source.sizeScale, normalizedAge)
      this.size.copy(particle.size).multiplyScalar(growth)
      this.worldVelocity.copy(particle.velocity).applyQuaternion(this.groupRotation)
      const alignment = Math.atan2(this.worldVelocity.dot(this.cameraUp), this.worldVelocity.dot(this.cameraRight)) - Math.PI / 2
      this.spin.setFromAxisAngle(this.zAxis, alignment + particle.spin + particle.spinRate * particle.age)
      this.rotation.copy(this.localCamera).multiply(this.spin)
      this.matrix.compose(particle.position, this.rotation, this.size)
      this.mesh.setMatrixAt(index, this.matrix)
      const fadeIn = this.source.fadeIn > 0 ? Math.min(1, particle.age / this.source.fadeIn) : 1
      const fadeOut = particle.age > this.source.fadeOut
        ? Math.max(0, (particle.lifetime - particle.age) / Math.max(0.001, particle.lifetime - this.source.fadeOut)) : 1
      this.opacity.setX(index, fadeIn * fadeOut * this.source.opacity * level.opacity)
      this.frames.setX(index, particle.frame)
      this.tints.setXYZ(index, particle.tint.x, particle.tint.y, particle.tint.z)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.frames.needsUpdate = true
    this.opacity.needsUpdate = true
    this.tints.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh.dispose()
  }
}

export class WeaponEnchant {
  readonly config: EnchantConfig
  private readonly group = new Group()
  private readonly particlesGroup = new Group()
  private readonly tint = new Vector3()
  private readonly auraTint = new Color()
  private readonly firstColor = new Vector3()
  private readonly secondColor = new Vector3()
  private readonly surface: Mesh
  private readonly range: Mesh
  private readonly weaponMask: Mesh<BufferGeometry, ShaderMaterial>
  private readonly emitters: ParticleEmitter[]
  private readonly materials: ShaderMaterial[] = []
  private level = 0
  private time = 0
  private wireframe = false
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private readonly studyMode = getEnchantStudyMode()
  private readonly volumeStudy = this.studyMode === 'volume' || this.studyMode === 'volume-full'
  private readonly rangeCamera = new Vector3()
  private readonly rangeInverse = new Matrix4()

  static async create(weapon: Mesh, signal: AbortSignal): Promise<WeaponEnchant> {
    const resources = await loadResources(signal)
    return new WeaponEnchant(weapon, resources)
  }

  private constructor(weapon: Mesh, private readonly resources: Resources) {
    this.config = resources.config
    this.group.name = 'weapon-enchantment'
    this.group.visible = false
    this.group.userData.viewerEffect = true
    const material = (Array.isArray(weapon.material) ? weapon.material[0] : weapon.material) as MeshStandardMaterial
    weapon.geometry.computeBoundingBox()
    const extent = weapon.geometry.boundingBox!.getSize(new Vector3()).length()
    const [pitch, yaw, roll] = this.config.surface.rotation
    const rotation = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromEuler(new Euler(roll, pitch, yaw, 'ZYX')))
    const range = this.config.range
    const rangeScale = new Vector3(range.scale[0], range.scale[2], range.scale[1])
    const rangeOffset = fromUnreal(new Vector3(), range.offset)
    const sphere = resources.rangeGeometry.boundingSphere!
    const rangeCenter = sphere.center.clone().multiply(rangeScale).add(rangeOffset)
    const rangeRadii = rangeScale.clone().multiplyScalar(sphere.radius)
    const normalComposition = this.studyMode === null || this.studyMode === 'full'
    const detailSurface = normalComposition || this.studyMode === 'volume-full'
    const surfaceMaterial = new ShaderMaterial({
      ...translucent, side: DoubleSide,
      forceSinglePass: true,
      uniforms: {
        uAura: { value: resources.cube }, uMask: { value: material.map }, uHasMask: { value: Boolean(material.map) },
        uAlphaCutoff: { value: material.alphaTest || 0.04 },
        uRotation: { value: rotation }, uTint: { value: detailSurface ? this.auraTint : this.tint }, uOpacity: { value: 0 },
        uGain: { value: normalComposition ? WEAPON_SHIMMER_GAIN : 1 }, uExtrude: { value: extent * 0.0006 },
        uRangeCenter: { value: rangeCenter }, uRangeRadii: { value: rangeRadii },
      },
      vertexShader: surfaceVertex, fragmentShader: detailSurface ? detailEmissionFragment : surfaceFragment,
    })
    this.surface = new Mesh(weapon.geometry, surfaceMaterial)
    this.surface.name = detailSurface ? 'enchant-weapon-shimmer' : 'enchant-surface'
    this.surface.renderOrder = 3
    this.surface.userData.viewerEffect = true
    if (this.studyMode === 'volume-full') {
      // Web reconstruction exposure for detail-driven emission, not a palette edit.
      surfaceMaterial.uniforms.uGain!.value = 2
    }
    // Normal rendering uses texture-driven shimmer, not the legacy flat recolor.
    this.surface.visible = detailSurface || this.studyMode === 'surface' || this.studyMode === 'before'

    const maskMaterial = new ShaderMaterial({
      transparent: true, toneMapped: false, blending: NoBlending,
      colorWrite: this.studyMode === 'mask', depthWrite: false, side: material.side,
      stencilWrite: true, stencilRef: 1, stencilWriteMask: 1, stencilFuncMask: 1,
      stencilFunc: AlwaysStencilFunc, stencilFail: KeepStencilOp,
      stencilZFail: KeepStencilOp, stencilZPass: ReplaceStencilOp,
      uniforms: { uMask: { value: material.map }, uHasMask: { value: Boolean(material.map) }, uAlphaCutoff: { value: material.alphaTest || 0.04 }, uExtrude: { value: 0 } },
      vertexShader: surfaceVertex, fragmentShader: weaponMaskFragment,
    })
    this.weaponMask = new Mesh(weapon.geometry, maskMaterial)
    this.weaponMask.name = 'enchant-weapon-protection'
    this.weaponMask.userData.viewerEffect = true
    this.weaponMask.renderOrder = 1

    const rangeMaterial = new ShaderMaterial({
      ...translucent,
      side: this.volumeStudy ? DoubleSide : FrontSide,
      forceSinglePass: true,
      // Keep the broad aura off the weapon; its detail-driven shimmer is a separate pass.
      stencilWrite: this.studyMode !== 'before', stencilRef: 1, stencilWriteMask: 0, stencilFuncMask: 1,
      stencilFunc: NotEqualStencilFunc, stencilFail: KeepStencilOp,
      stencilZFail: KeepStencilOp, stencilZPass: KeepStencilOp,
      uniforms: {
        uAura: { value: resources.cube }, uMask: { value: null }, uHasMask: { value: false },
        uRotation: { value: rotation }, uTint: { value: this.studyMode === 'before' ? this.tint : this.auraTint }, uOpacity: { value: 0 },
        uGain: { value: normalComposition || this.studyMode === 'aura' ? AURA_GAIN : 1 }, uExtrude: { value: 0 },
        uLegacyComposite: { value: this.studyMode === 'before' },
        uCameraLocal: { value: this.rangeCamera }, uSphereCenter: { value: sphere.center }, uSphereRadius: { value: sphere.radius },
      },
      vertexShader: surfaceVertex, fragmentShader: this.volumeStudy ? volumeFragment : rangeFragment,
    })
    this.range = new Mesh(resources.rangeGeometry, rangeMaterial)
    this.range.name = 'enchant-range-aura'
    this.range.userData.viewerEffect = true
    this.range.renderOrder = 2
    this.range.scale.copy(rangeScale)
    this.range.position.copy(rangeOffset)
    this.materials.push(surfaceMaterial, rangeMaterial)
    this.group.add(this.weaponMask, this.range, this.surface, this.particlesGroup)
    fromUnreal(this.particlesGroup.position, this.config.attachment.offset)
    this.particlesGroup.scale.setScalar(this.config.attachment.scale)
    this.emitters = this.config.emitters.map((source, index) => new ParticleEmitter(source, resources.textures.get(source.texture)!, this.tint, 7575 + index * 103))
    for (const emitter of this.emitters) this.particlesGroup.add(emitter.mesh)
    weapon.add(this.group)
  }

  setLevel(value: number): void {
    const next = clampEnchant(value)
    if (next === this.level) return
    const hadParticles = this.level >= this.config.particlesStart
    this.level = next
    const level = this.config.levels[next]!
    this.group.visible = next >= this.config.meshStart && this.studyMode !== 'base' && this.studyMode !== 'bow-blend' && !this.wireframe
    this.range.visible = this.studyMode !== 'surface' && this.studyMode !== 'particles' && this.studyMode !== 'mask'
    this.weaponMask.visible = (this.range.visible && this.studyMode !== 'before') || this.studyMode === 'mask'
    this.particlesGroup.visible = next >= this.config.particlesStart && !['base', 'aura', 'aura-srgb', 'aura-data', 'volume', 'surface', 'mask'].includes(this.studyMode ?? '')
    this.firstColor.fromArray(level.color1).multiplyScalar(1 / 255)
    this.secondColor.fromArray(level.color2).multiplyScalar(1 / 255)
    for (const material of this.materials) material.uniforms.uOpacity!.value = level.opacity
    if (!this.particlesGroup.visible) {
      for (const emitter of this.emitters) emitter.reset()
    } else if (!hadParticles || this.studyMode || this.reducedMotion) {
      // Warm up first activation and rebuild frozen previews for the selected level.
      for (const emitter of this.emitters) emitter.reset()
      for (let step = 0; step < 120; step += 1) for (const emitter of this.emitters) emitter.advance(1 / 30, level.density)
    }
  }

  update(delta: number, camera: PerspectiveCamera): void {
    if (!this.group.visible) return
    const level = this.config.levels[this.level]!
    if (!this.reducedMotion && !this.studyMode) this.time += delta
    const phase = (this.time / this.config.surface.fadePeriod + this.config.surface.fadePhase) % 1
    const mix = this.reducedMotion || this.studyMode ? 0.5 : 1 - Math.abs(2 * phase - 1)
    this.tint.copy(this.firstColor).lerp(this.secondColor, mix)
    // Palette bytes are display/sRGB values, not already-linear shader inputs.
    // Convert only the aura; leave the accepted particle tint and palette intact.
    this.auraTint.setRGB(this.tint.x, this.tint.y, this.tint.z, SRGBColorSpace)
    if (this.volumeStudy) {
      this.range.updateWorldMatrix(true, false)
      this.rangeInverse.copy(this.range.matrixWorld).invert()
      camera.getWorldPosition(this.rangeCamera).applyMatrix4(this.rangeInverse)
    }
    if (!this.particlesGroup.visible) return
    this.particlesGroup.updateWorldMatrix(true, false)
    for (const emitter of this.emitters) {
      if (!this.reducedMotion && !this.studyMode) emitter.advance(delta, level.density)
      emitter.updateMatrices(this.particlesGroup, camera, level)
    }
  }

  setWireframe(enabled: boolean): void {
    this.wireframe = enabled
    this.group.visible = this.level >= this.config.meshStart && this.studyMode !== 'base' && this.studyMode !== 'bow-blend' && !enabled
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const emitter of this.emitters) emitter.dispose()
    for (const material of this.materials) material.dispose()
    this.weaponMask.material.dispose()
    this.resources.cube.dispose()
    this.resources.rangeGeometry.dispose()
    for (const texture of this.resources.textures.values()) texture.dispose()
    // Surface meshes share the original bow geometry: do not dispose it here.
  }
}
