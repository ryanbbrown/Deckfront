import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: [
    'dist/**', 'dist-sim/**', 'dist-benchmark/**', 'rust/target/**', 'coverage/**', '.reviews/**',
    '.e2e-report/**', '.e2e-results/**'
  ] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/sim/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/client', '**/client/**', '**/server', '**/server/**', '**/shared', '**/shared/**'],
          message: 'Simulation code can import only simulator modules and src/game/.'
        }]
      }]
    }
  },
  {
    files: ['src/game/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/client', '**/client/**', '**/server', '**/server/**', '**/shared', '**/shared/**', '**/sim', '**/sim/**'],
          message: 'Game code can import only game modules and src/game-data/.'
        }]
      }]
    }
  }
);
