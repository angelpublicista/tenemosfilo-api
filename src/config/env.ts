import 'dotenv/config';
import { z } from 'zod';

/**
 * Elige a que base se conecta el servidor.
 *
 * Precedencia (la misma que scripts/resolve-db-url.mjs usa para la CLI de
 * Prisma; si cambias una, cambia la otra):
 *   1. DATABASE_URL explicita  -> manda (es lo que inyectan los deploys)
 *   2. DB_TARGET=local         -> DATABASE_URL_LOCAL      (default)
 *   3. DB_TARGET=production    -> DATABASE_URL_PRODUCTION
 *
 * El default es 'local' a proposito: arrancar sin configurar nada debe
 * pegarle a la base de desarrollo, nunca a produccion.
 */
function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const target = process.env.DB_TARGET ?? 'local';
  if (target !== 'local' && target !== 'production') {
    console.error(`DB_TARGET invalido: "${target}". Valores: local | production`);
    process.exit(1);
  }
  const varName = target === 'local' ? 'DATABASE_URL_LOCAL' : 'DATABASE_URL_PRODUCTION';
  const url = process.env[varName];
  if (!url) {
    console.error(`DB_TARGET=${target} pero ${varName} no esta definida en .env`);
    process.exit(1);
  }
  return url;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16, 'NEXTAUTH_SECRET debe tener al menos 16 caracteres'),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // ──────── Correo transaccional (Brevo) ────────
  // Necesario para la recuperacion de contraseña. Si faltan, el endpoint
  // sigue respondiendo 204 pero no se envia nada (queda en el log).
  BREVO_API_KEY: z.string().optional().default(''),
  BREVO_FROM_EMAIL: z.string().optional().default(''),
  // Base para armar el enlace del correo: {APP_URL}/reset-password?token=...
  APP_URL: z.string().url().default('http://localhost:3000'),

  // ──────── AWS S3 (uploads) ────────
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_BUCKET: z.string().optional().default(''),
  // Opcional: dominio publico (CloudFront u otro). Si no se setea, se usa
  // el endpoint S3 estandar https://{bucket}.s3.{region}.amazonaws.com
  S3_PUBLIC_URL_BASE: z.string().optional().default(''),
  // Limite duro server-side (el front tambien valida). 10 MB por defecto.
  // Cuantos proxies hay delante del API. En local 0; detras de un balanceador
  // o de Nginx normalmente 1. Si se deja en 0 con un proxy delante, el limite
  // por IP cuenta a todos los visitantes como si fueran uno solo.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  UPLOADS_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
});

const parsed = envSchema.safeParse({
  ...process.env,
  DATABASE_URL: resolveDatabaseUrl(),
});

if (!parsed.success) {
  console.error('Error en variables de entorno:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** 'local' | 'production' | 'explicito' — para logs de arranque. */
export const dbTarget = process.env.DATABASE_URL
  ? 'explicito'
  : (process.env.DB_TARGET ?? 'local');

export const corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
