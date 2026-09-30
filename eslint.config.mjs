import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'coverage/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-throw-literal': 'error'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /* The interface is sandboxed: it reaches the main process through the preload bridge and never
         by importing its modules. The mapping in `tsconfig.web.json` exists only for the flow tests
         under `tests/renderer`, which deliberately run against the real router. */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main/*', '../../main/*', '**/src/main/*'],
              message: 'The renderer talks to the main process through the preload bridge, never by importing it.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
    /* Scripts are command-line tools operated from a terminal; their progress output is the interface. */
    rules: { 'no-console': 'off' }
  }
)
