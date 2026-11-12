/** Public resources share Vite's base path, including project sites on GitHub Pages. */
export function publicAssetUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '')
}
