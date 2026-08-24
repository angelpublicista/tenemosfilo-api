import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { corsOrigins, env } from './config/env.js';
import { logger } from './lib/logger.js';
import { auditLog } from './middleware/audit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import { authRouter } from './modules/auth/auth.routes.js';
import { apiKeysRouter } from './modules/api-keys/api-keys.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { channelsRouter } from './modules/channels/channels.routes.js';
import { companiesRouter } from './modules/companies/companies.routes.js';
import { crmCompaniesRouter } from './modules/crm-companies/crm-companies.routes.js';
import { contactsRouter } from './modules/contacts/contacts.routes.js';
import { opportunitiesRouter } from './modules/opportunities/opportunities.routes.js';
import { experiencesRouter } from './modules/experiences/experiences.routes.js';
import { reservationsRouter } from './modules/reservations/reservations.routes.js';
import { quotesRouter } from './modules/quotes/quotes.routes.js';
import { availabilitiesRouter } from './modules/availabilities/availabilities.routes.js';
import { locationsRouter } from './modules/locations/locations.routes.js';
import { integrationsRouter } from './modules/integrations/integrations.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { uploadsRouter } from './modules/uploads/uploads.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { payoutsRouter } from './modules/payouts/payouts.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { publicRouter } from './modules/public/public.routes.js';
import { docsRouter } from './modules/docs/docs.routes.js';
import { limiteGeneral, limitePublico, limiteSondeoDeKeys } from './middleware/rate-limit.js';

export function createApp() {
  const app = express();

  // Cuantos proxies hay delante. Sin esto, en produccion todas las
  // peticiones parecen venir del proxy y el limite por IP las cuenta como
  // si fueran un unico visitante: el primero que se pase deja fuera a todo
  // el mundo. En local no hay proxy, asi que el valor por defecto es 0.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origen no permitido por CORS: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(pinoHttp({ logger }));

  // El health check va ANTES de cualquier limite: lo consultan los sistemas
  // de monitorizacion cada pocos segundos, y que un pico de trafico lo
  // dejara sin responder haria que el servicio pareciera caido justo cuando
  // mas falta hace saber que sigue en pie.
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  // Corta el sondeo de API keys. Los limites por credencial van despues,
  // ruta por ruta.
  app.use(limiteSondeoDeKeys);

  // Va antes de los routers para poder engancharse al final de la respuesta,
  // y despues de express.json para ver el body ya parseado.
  app.use(auditLog);

  // Documentacion. La CSP global de helmet solo permite scripts propios;
  // el visor carga el suyo desde un CDN, asi que se relaja aqui y solo
  // aqui, y unicamente para ese origen.
  app.use(
    '/docs',
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    }),
    docsRouter,
  );

  // Catalogo publico: va antes que el resto, no lleva auth.
  app.use('/public', limitePublico, publicRouter);

  app.use('/auth', authRouter);
  app.use('/api-keys', limiteGeneral, apiKeysRouter);
  app.use('/users', limiteGeneral, usersRouter);
  app.use('/channels', limiteGeneral, channelsRouter);
  app.use('/companies', limiteGeneral, companiesRouter);
  app.use('/crm-companies', limiteGeneral, crmCompaniesRouter);
  app.use('/contacts', limiteGeneral, contactsRouter);
  app.use('/opportunities', limiteGeneral, opportunitiesRouter);
  app.use('/experiences', limiteGeneral, experiencesRouter);
  app.use('/reservations', limiteGeneral, reservationsRouter);
  app.use('/quotes', limiteGeneral, quotesRouter);
  app.use('/availabilities', limiteGeneral, availabilitiesRouter);
  app.use('/locations', limiteGeneral, locationsRouter);
  app.use('/integrations', limiteGeneral, integrationsRouter);
  app.use('/dashboard', limiteGeneral, dashboardRouter);
  app.use('/uploads', limiteGeneral, uploadsRouter);
  app.use('/audit-logs', limiteGeneral, auditRouter);
  app.use('/settings', limiteGeneral, settingsRouter);
  app.use('/payouts', limiteGeneral, payoutsRouter);
  app.use('/payments', limiteGeneral, paymentsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
