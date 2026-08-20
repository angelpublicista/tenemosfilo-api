// Resuelve a que base apunta la CLI de Prisma y ejecuta el comando pedido.
//
// El problema que resuelve: `prisma` solo lee DATABASE_URL. Si esa variable
// apunta a produccion, un `migrate dev` de mas se lleva por delante el RDS.
// Aqui la eleccion es explicita (DB_TARGET) y el default es 'local'.
//
// Uso: node scripts/resolve-db-url.mjs prisma migrate dev
//
// Ojo: la misma precedencia esta implementada para el runtime del servidor
// en src/config/env.ts. Si cambias una, cambia la otra.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm run agrega node_modules/.bin al PATH, pero invocar el script con `node`
// a secas no. Lo agregamos para que funcione de las dos formas.
const binDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'node_modules', '.bin');

const TARGETS = ['local', 'production'];

// Comandos que pueden destruir datos: contra produccion exigen opt-in.
// `migrate deploy` NO esta aqui: es justamente la via para publicar
// migraciones en produccion y solo aplica las pendientes.
const DESTRUCTIVE = [
  ['migrate', 'dev'],
  ['migrate', 'reset'],
  ['db', 'push'],
];

function resolveDatabaseUrl() {
  // Escotilla de escape: un DATABASE_URL explicito manda. Es lo que usan
  // los deploys, que inyectan la variable desde la plataforma.
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, target: 'explicito (DATABASE_URL)' };
  }

  const target = process.env.DB_TARGET ?? 'local';
  if (!TARGETS.includes(target)) {
    throw new Error(`DB_TARGET invalido: "${target}". Valores: ${TARGETS.join(' | ')}`);
  }

  const varName = target === 'local' ? 'DATABASE_URL_LOCAL' : 'DATABASE_URL_PRODUCTION';
  const url = process.env[varName];
  if (!url) {
    throw new Error(`DB_TARGET=${target} pero ${varName} no esta definida en .env`);
  }
  return { url, target };
}

function isDestructive(args) {
  return DESTRUCTIVE.some((combo) => combo.every((word) => args.includes(word)));
}

/** Oculta la contraseña al imprimir la URL. */
function redact(url) {
  return url.replace(/:\/\/([^:/@]*)(:[^@]*)?@/, '://$1:***@');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Falta el comando. Ej: node scripts/resolve-db-url.mjs prisma migrate dev');
  process.exit(1);
}

let resolved;
try {
  resolved = resolveDatabaseUrl();
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
}

const apuntaAProduccion = resolved.target === 'production';

if (apuntaAProduccion && isDestructive(args) && process.env.ALLOW_PRODUCTION_DB !== '1') {
  console.error(
    `\n  BLOQUEADO: "${args.join(' ')}" contra PRODUCCION.\n` +
      `  Ese comando puede borrar datos.\n\n` +
      `  Si de verdad es lo que quieres:\n` +
      `    ALLOW_PRODUCTION_DB=1 DB_TARGET=production npm run <script>\n`,
  );
  process.exit(1);
}

console.log(`\n  base: ${resolved.target}  ->  ${redact(resolved.url)}\n`);

const [cmd, ...rest] = args;
const child = spawn(cmd, rest, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: resolved.url,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`No se pudo ejecutar "${cmd}": ${err.message}`);
  process.exit(1);
});
