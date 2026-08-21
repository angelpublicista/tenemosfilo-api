// Distribucion de experiencias en canales externos.
//
// Todo se resuelve contra la empresa de la sesion (o la empresa activa del
// admin): un anfitrion solo distribuye lo suyo.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { BadRequest } from '../../lib/errors.js';
import { channelsService } from './channels.service.js';
import {
  channelParamsSchema,
  marcarPublicadaSchema,
  type ChannelParams,
  type MarcarPublicadaInput,
} from './channels.schemas.js';

export const channelsRouter = Router();

channelsRouter.use(requireAuth, requireHumanAuth);

function empresaDeLaSesion(req: Request): string {
  const companyId = req.user?.companyId;
  if (!companyId) throw BadRequest('Selecciona una empresa para distribuir sus experiencias');
  return companyId;
}

/** Canales que la plataforma sabe alimentar. */
channelsRouter.get('/', async (_req: Request, res: Response) => {
  res.json({ data: channelsService.catalogo() });
});

/** Que experiencia esta en que canal. */
channelsRouter.get('/listings', async (req: Request, res: Response) => {
  res.json({ data: await channelsService.resumen(empresaDeLaSesion(req)) });
});

/** La ficha lista para cargar, con lo que falte por resolver. */
channelsRouter.get(
  '/:channel/experiences/:experienceId',
  validate(channelParamsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { channel, experienceId } = req.params as unknown as ChannelParams;
    res.json({
      data: await channelsService.ficha(empresaDeLaSesion(req), experienceId, channel),
    });
  },
);

channelsRouter.post(
  '/:channel/experiences/:experienceId/published',
  validate(channelParamsSchema, 'params'),
  validate(marcarPublicadaSchema),
  async (req: Request, res: Response) => {
    const { channel, experienceId } = req.params as unknown as ChannelParams;
    const listing = await channelsService.marcarPublicada(
      empresaDeLaSesion(req),
      experienceId,
      channel,
      req.body as MarcarPublicadaInput,
    );
    res.status(201).json({ data: listing });
  },
);

channelsRouter.delete(
  '/:channel/experiences/:experienceId/published',
  validate(channelParamsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { channel, experienceId } = req.params as unknown as ChannelParams;
    res.json({
      data: await channelsService.despublicar(empresaDeLaSesion(req), experienceId, channel),
    });
  },
);
