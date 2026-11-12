import { Line, Mesh, Points, SkinnedMesh, Texture } from 'three'
import type { AnimationClip, Material, Object3D } from 'three'

export const MAX_FILE_SIZE = 100 * 1024 * 1024

export interface ModelInfo {
  name: string
  size: number
  meshes: number
  vertices: number
  triangles: number
  materials: number
  bones: number
  animations: number
  animationNames: string[]
}

export function validateModelFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.name.toLowerCase().endsWith('.glb')) {
    return 'Нужен файл .glb. Экспортируйте модель из Blender в формате glTF Binary.'
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'Файл больше 100 МБ. Уменьшите текстуры или разделите модель перед экспортом.'
  }
  if (file.size < 20) return 'Файл пуст или повреждён: в нём нет заголовка GLB.'
  return null
}

interface GlbDocument {
  asset?: { version?: string }
  buffers?: { uri?: string }[]
  images?: { uri?: string }[]
  extensionsRequired?: string[]
}

/** Просмотр локальный: не разрешаем модели обращаться к внешним файлам или URL. */
export function validateEmbeddedGlb(buffer: ArrayBuffer): void {
  const view = new DataView(buffer)
  if (
    buffer.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  ) {
    throw new Error('Не удалось прочитать GLB 2.0. Проверьте файл или повторите экспорт из Blender.')
  }

  const jsonLength = view.getUint32(12, true)
  if (jsonLength === 0 || jsonLength % 4 !== 0 || 20 + jsonLength > buffer.byteLength) {
    throw new Error('GLB повреждён: некорректная длина JSON-данных.')
  }

  let document: GlbDocument
  try {
    document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as GlbDocument
    if (!document || document.asset?.version !== '2.0') throw new Error('version')
  } catch {
    throw new Error('GLB содержит некорректное описание glTF 2.0.')
  }

  for (const resources of [document.buffers, document.images]) {
    if (resources !== undefined && !Array.isArray(resources)) {
      throw new Error('Некорректный список ресурсов в GLB.')
    }
    for (const resource of resources ?? []) {
      if (!resource || (resource.uri !== undefined && typeof resource.uri !== 'string')) {
        throw new Error('Некорректная ссылка на ресурс в GLB.')
      }
      if (resource.uri !== undefined && !resource.uri.startsWith('data:')) {
        throw new Error('У модели есть внешние файлы. Встройте текстуры и геометрию при экспорте в GLB.')
      }
    }
  }

  const unsupported = ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression']
  if (
    document.extensionsRequired !== undefined &&
    (!Array.isArray(document.extensionsRequired) ||
      document.extensionsRequired.some((extension) => typeof extension !== 'string'))
  ) {
    throw new Error('Некорректный список расширений GLB.')
  }
  if (document.extensionsRequired?.some((extension) => unsupported.includes(extension))) {
    throw new Error('Пока поддерживается GLB без Draco, Meshopt и KTX2. Отключите сжатие при экспорте.')
  }
}

export function inspectModel(
  root: Object3D,
  animations: AnimationClip[],
  file: Pick<File, 'name' | 'size'>,
): ModelInfo {
  const materials = new Set<Material>()
  const bones = new Set<Object3D>()
  let meshes = 0
  let vertices = 0
  let triangles = 0

  root.traverse((object) => {
    if (object.type === 'Bone') bones.add(object)
    if (!(object instanceof Mesh)) return

    meshes += 1
    const positions = object.geometry.getAttribute('position')?.count ?? 0
    vertices += positions
    triangles += Math.floor((object.geometry.index?.count ?? positions) / 3)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
    }
    if (object instanceof SkinnedMesh) {
      for (const bone of object.skeleton.bones) bones.add(bone)
    }
  })

  return { name: file.name, size: file.size, meshes, vertices, triangles, materials: materials.size, bones: bones.size, animations: animations.length, animationNames: animations.map((clip) => clip.name) }
}

export function disposeObject(root: Object3D): void {
  const geometries = new Set<Mesh['geometry']>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()

  root.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof Line || object instanceof Points)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
    }
    if (object instanceof SkinnedMesh && object.skeleton.boneTexture) {
      textures.add(object.skeleton.boneTexture)
    }
  })

  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
  for (const geometry of geometries) geometry.dispose()
  root.removeFromParent()
}

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024))} МБ`
  if (bytes >= 1024) return `${formatNumber(bytes / 1024)} КБ`
  return `${bytes} Б`
}
