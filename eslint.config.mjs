// Config plana de ESLint 9.
//
// No habia ninguna: `npm run lint` fallaba antes de mirar un solo archivo
// ("couldn't find an eslint.config file"), asi que las reglas que el codigo
// ya daba por buenas —hay `eslint-disable-next-line @typescript-eslint/...`
// repartidos— no las comprobaba nadie.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `dist` es la salida del build, `prisma/` es SQL y schema, y
    // `ecosystem.config.js` es la config de PM2: CommonJS a proposito.
    ignores: [
      'dist/**',
      'node_modules/**',
      'prisma/**',
      'coverage/**',
      'ecosystem.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      // Un argumento sin usar con guion bajo delante es intencionado: dice
      // "esto llega pero no me hace falta", que es justo lo que pasa con el
      // `_next` de los handlers de error de Express.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
