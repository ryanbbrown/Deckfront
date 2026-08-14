import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: [
    'dist/**', 'coverage/**', '.reviews/**', 'src/legacy/**',
    '.e2e-report/**', '.e2e-live-report/**', '.e2e-results/**', '.e2e-live-results/**'
  ] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
);
