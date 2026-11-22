import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', '.agents/', 'android/', 'ios/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      // `_` na frente marca o que é ignorado de propósito (ex.: `(_req, res)`)
      // `catch {}` vazio � de prop�sito (localStorage bloqueado, �udio sem permiss�o...)
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  { files: ['server/**', 'test/**', '*.config.js'], languageOptions: { globals: globals.node } },
  { files: ['client/**'], languageOptions: { globals: globals.browser } },
  { files: ['public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // as regras rodam no servidor e no navegador: só o que existe nos dois
  { files: ['shared/**'], languageOptions: { globals: { ...globals['shared-node-browser'], crypto: 'readonly' } } },
];
