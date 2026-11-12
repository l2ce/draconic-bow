import { DoubleSide, MeshStandardMaterial } from 'three'
import type { Mesh } from 'three'

/** FinalBlend draconic_bow_t00_wp, read from the supplied High Five client. */
export const DRACONIC_BOW_MATERIAL = {
  source: 'LineageWeaponsTex.draconic_bow_t00_wp',
  alphaRef: 160,
  alphaCutoff: 160 / 255,
  depthWrite: true,
  depthTest: true,
  twoSided: true,
  framebufferBlending: 'FB_AlphaBlend',
} as const

/** Restore native depth/alpha flags without changing geometry, albedo or animations. */
export function applyNativeBowMaterial(weapon: Mesh): void {
  for (const material of Array.isArray(weapon.material) ? weapon.material : [weapon.material]) {
    if (!(material instanceof MeshStandardMaterial)) continue
    material.transparent = true // The native FinalBlend still uses alpha blending.
    material.depthWrite = DRACONIC_BOW_MATERIAL.depthWrite
    material.depthTest = DRACONIC_BOW_MATERIAL.depthTest
    material.alphaTest = DRACONIC_BOW_MATERIAL.alphaCutoff
    material.side = DoubleSide
    material.forceSinglePass = true
    material.needsUpdate = true
  }
  weapon.userData.nativeMaterialSource = DRACONIC_BOW_MATERIAL.source
}
