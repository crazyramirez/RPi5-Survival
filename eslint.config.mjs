import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.output/**', '**/.nuxt/**', '**/dist/**', 'release/**', 'coverage/**', '.data/**', 'apps/frontend/public/map-assets/**'],
  },
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' },
    },
  },
  {
    rules: {
      // Páginas de Nuxt (index.vue, sistema.vue…) tienen nombre de una palabra por convención.
      'vue/multi-word-component-names': 'off',
      // Estilo de atributos: no bloquear por formato en Fase 1.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Scripts CLI: la consola es su interfaz.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
)
