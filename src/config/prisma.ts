import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    // Explicito a proposito: schema.prisma declara env("DATABASE_URL"), que el
    // cliente leeria del proceso e ignoraria la resolucion por DB_TARGET.
    // Pasandola aqui, servidor y CLI usan siempre la misma base.
    datasourceUrl: env.DATABASE_URL,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') globalThis.__prisma = prisma;
