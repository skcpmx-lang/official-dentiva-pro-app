import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fails fast, and with a usable message, when the end-to-end suite is started without a build.
 *
 * The workflows launch the real bundle (`out/main`, `out/preload`), exactly as the installer packages
 * it — running the suite against sources would test something the clinic never installs.
 */
export default function globalSetup(): void {
  const appRoot = join(__dirname, '..', '..', '..')
  const required = [join(appRoot, 'out', 'main', 'index.js'), join(appRoot, 'out', 'preload', 'index.js')]
  const missing = required.filter((file) => !existsSync(file))
  if (missing.length > 0) {
    throw new Error(
      `The end-to-end suite runs against the built application, but ${missing.join(', ')} is missing. ` +
        'Run `npm run build` first — the CI workflows build before they call `npm run test:e2e`.'
    )
  }
}
