// Mirrors the lint setup of GoogleChrome/chrome-extensions-samples.
import js from '@eslint/js';
import globals from 'globals';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  js.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    rules: {
      'prettier/prettier': ['error'],
      'no-var': ['error'],
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker
      }
    }
  },
  {
    files: ['tests/**/*.mjs', 'store/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, chrome: 'readonly' }
    }
  },
  { ignores: ['node_modules/**', 'eslint.config.mjs'] }
];
