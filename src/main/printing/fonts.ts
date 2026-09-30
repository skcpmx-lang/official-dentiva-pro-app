import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bundled font embedding for printed documents and PDFs.
 *
 * Print windows and the PDF renderer must never depend on the machine's installed fonts (a Windows
 * installation can lack a Bengali face entirely). The Inter (Latin/UI) and Noto Sans Bengali faces we
 * ship are therefore read from disk and embedded as data URIs into the document stylesheet, which
 * makes every printed page and every PDF independent of the host system and of the network.
 */

export interface EmbeddedFont {
  family: string
  weight: number
  style: 'normal'
  package: string
  file: string
}

const FONTS: readonly EmbeddedFont[] = [
  { family: 'Inter', weight: 400, style: 'normal', package: '@fontsource/inter', file: 'inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 500, style: 'normal', package: '@fontsource/inter', file: 'inter-latin-500-normal.woff2' },
  { family: 'Inter', weight: 600, style: 'normal', package: '@fontsource/inter', file: 'inter-latin-600-normal.woff2' },
  { family: 'Inter', weight: 700, style: 'normal', package: '@fontsource/inter', file: 'inter-latin-700-normal.woff2' },
  { family: 'Noto Sans Bengali', weight: 400, style: 'normal', package: '@fontsource/noto-sans-bengali', file: 'noto-sans-bengali-bengali-400-normal.woff2' },
  { family: 'Noto Sans Bengali', weight: 500, style: 'normal', package: '@fontsource/noto-sans-bengali', file: 'noto-sans-bengali-bengali-500-normal.woff2' },
  { family: 'Noto Sans Bengali', weight: 600, style: 'normal', package: '@fontsource/noto-sans-bengali', file: 'noto-sans-bengali-bengali-600-normal.woff2' },
  { family: 'Noto Sans Bengali', weight: 700, style: 'normal', package: '@fontsource/noto-sans-bengali', file: 'noto-sans-bengali-bengali-700-normal.woff2' }
]

export interface FontResolverOptions {
  appRoot: string
  /** Packaged applications copy the font files into `resources/fonts`. */
  resourcesPath: string | null
  isPackaged: boolean
}

function candidatePaths(options: FontResolverOptions, font: EmbeddedFont): string[] {
  const candidates: string[] = []
  if (options.resourcesPath) {
    candidates.push(join(options.resourcesPath, 'fonts', font.file))
    candidates.push(join(options.resourcesPath, 'fonts', font.package.replace('@fontsource/', ''), font.file))
  }
  candidates.push(join(options.appRoot, 'node_modules', font.package, 'files', font.file))
  candidates.push(join(options.appRoot, '..', 'node_modules', font.package, 'files', font.file))
  return candidates
}

let cachedCss: string | null = null
let cachedMissing: string[] = []

/** `@font-face` rules with embedded data URIs, cached for the lifetime of the process. */
export function embeddedFontFaceCss(options: FontResolverOptions): string {
  if (cachedCss !== null) return cachedCss
  const rules: string[] = []
  const missing: string[] = []
  for (const font of FONTS) {
    const path = candidatePaths(options, font).find((candidate) => existsSync(candidate))
    if (!path) {
      missing.push(font.file)
      continue
    }
    try {
      const base64 = readFileSync(path).toString('base64')
      rules.push(
        `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${base64}) format('woff2');}`
      )
    } catch {
      missing.push(font.file)
    }
  }
  cachedMissing = missing
  cachedCss = rules.join('\n')
  return cachedCss
}

export function missingBundledFonts(): string[] {
  return [...cachedMissing]
}

