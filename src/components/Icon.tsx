import type { CSSProperties } from 'react'

export type IconName = 'bow' | 'upload' | 'cube' | 'rotate' | 'reset' | 'expand' | 'plus' | 'minus' | 'arrow' | 'close' | 'shield' | 'mouse' | 'grid' | 'layers' | 'check'

const paths: Record<IconName, string[]> = {
  bow: ['M8 3c13 4 13 14 0 18l5-9-5-9Z', 'M3 12h18m-4-4 4 4-4 4'],
  upload: ['M12 15V3m-4 4 4-4 4 4', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  cube: ['m12 3 9 5v9l-9 5-9-5V8l9-5Z', 'm3 8 9 5 9-5M12 13v9M7.5 5.5l9 5'],
  rotate: ['M20 11a8 8 0 1 0-2 6', 'M20 4v7h-7'],
  reset: ['M4 4v6h6', 'M4 10a8 8 0 1 1 1 8'],
  expand: ['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  arrow: ['M5 12h14m-5-5 5 5-5 5'],
  close: ['m6 6 12 12M6 18 18 6'],
  shield: ['m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z', 'm8 12 3 3 5-6'],
  mouse: ['M7 10V7a5 5 0 0 1 10 0v3', 'M5 10h14v5a7 7 0 0 1-14 0v-5ZM12 3v7'],
  grid: ['M3 3h18v18H3V3ZM3 9h18M3 15h18M9 3v18M15 3v18'],
  layers: ['m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5'],
  check: ['m5 12 4 4L19 6'],
}

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {paths[name].map((path) => <path key={path} d={path} />)}
    </svg>
  )
}
