import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 20000
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 120000,
          hookTimeout: 120000,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } }
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.tsx', 'tests/renderer/**/*.test.ts'],
          setupFiles: ['tests/renderer/setup.ts'],
          testTimeout: 20000
        }
      }
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/shared/**', 'src/main/modules/**', 'src/main/db/**'],
      thresholds: { statements: 70, branches: 60, functions: 70, lines: 70 }
    }
  }
})
