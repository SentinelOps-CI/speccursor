module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    'no-console': 'off',
    'no-debugger': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
      env: { jest: true },
    },
    {
      files: ['*.js', '**/*.config.js', '*rc.js', '**/*rc.js'],
      env: { node: true, commonjs: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
      rules: { 'no-undef': 'off' },
    },
  ],
};
