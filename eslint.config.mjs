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
      '**/out-tsc/**',
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
      // Angular components are classes carried by their decorator, sometimes without members.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // Command-line scripts (migrations, demo data) write their progress to the console.
    files: ['apps/api/db/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  // Désactive les règles de mise en forme, laissées à Prettier.
  prettier,
);
