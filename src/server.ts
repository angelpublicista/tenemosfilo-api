import { createApp } from './app.js';
import { dbTarget, env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { logger } from './lib/logger.js';
import { recaptchaActivo } from './lib/recaptcha.js';
import { enviarRecordatoriosDeSuscripcion } from './lib/suscripcion.js';

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
    // Que el registro no este filtrando nada es justo el tipo de cosa que se
    // descubre tarde y mal. Se dice al arrancar, no cuando ya entraron bots.
    if (!recaptchaActivo()) {
      logger.warn('reCAPTCHA SIN verificar: falta RECAPTCHA_SECRET_KEY, el registro no filtra bots');
    }
  });

  // Recordatorios de renovacion. No hay un planificador en la infraestructura,
  // asi que se revisa cada pocas horas desde aqui. Es idempotente —cada aviso
  // lleva una clave unica—, de modo que varias instancias o un reinicio no
  // mandan nada dos veces.
  const recordar = () =>
    enviarRecordatoriosDeSuscripcion().catch((err) =>
      logger.error({ err }, 'fallo el envio de recordatorios de suscripcion'),
    );
  const primerRecordatorio = setTimeout(() => void recordar(), 60_000);
  const recordatorios = setInterval(() => void recordar(), 6 * 60 * 60 * 1000);

  const shutdown = async (signal: string) => {
    logger.info(`Recibido ${signal}, cerrando...`);
    clearTimeout(primerRecordatorio);
    clearInterval(recordatorios);
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
