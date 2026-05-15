import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { corsOrigins } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
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

export function createApp() {
  const app = express();

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

  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/companies', companiesRouter);
  app.use('/crm-companies', crmCompaniesRouter);
  app.use('/contacts', contactsRouter);
  app.use('/opportunities', opportunitiesRouter);
  app.use('/experiences', experiencesRouter);
  app.use('/reservations', reservationsRouter);
  app.use('/quotes', quotesRouter);
  app.use('/availabilities', availabilitiesRouter);
  app.use('/locations', locationsRouter);
  app.use('/integrations', integrationsRouter);
  app.use('/dashboard', dashboardRouter);
  app.use('/uploads', uploadsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
