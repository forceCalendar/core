import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '**/*.min.js']
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022
      }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error']
        }
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-duplicate-imports': 'error',
      'no-template-curly-in-string': 'warn',
      'array-callback-return': 'error',
      'default-case-last': 'error',
      'dot-notation': 'warn',
      'no-else-return': 'warn',
      'no-empty-function': 'warn',
      'no-lonely-if': 'warn',
      'no-unneeded-ternary': 'warn',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      yoda: 'error'
    }
  }
];
