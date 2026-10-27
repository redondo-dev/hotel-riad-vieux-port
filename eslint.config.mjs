// Configuration ESLint commune à tout le dépôt (format « flat config »).
// Chaque application pourra la compléter avec ses propres règles (Angular, Node).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.angular/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    rules: {
      // Variables inutilisées : erreur, sauf celles préfixées par « _ » (paramètres imposés).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Les journaux passent par le logger (Pino), jamais par console.
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  // Désactive les règles de mise en forme, laissées à Prettier.
  prettier,
);
