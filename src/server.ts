import { createApp } from './app.js';
import { dbTarget, env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { logger } from './lib/logger.js';

/** Host de la BD sin credenciales, para saber de un vistazo contra que corres. */
function dbHost(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return 'desconocido';
  }
}

async function bootstrap() {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`API escuchando en http://localhost:${env.PORT} (${env.NODE_ENV})`);
    logger.info(`BD: ${dbTarget} -> ${dbHost(env.DATABASE_URL)}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Recibido ${signal}, cerrando...`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fallo al iniciar el servidor');
  process.exit(1);
});
