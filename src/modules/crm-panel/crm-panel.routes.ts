import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { crmPanelService } from './crm-panel.service.js';

export const crmPanelRouter = Router();

crmPanelRouter.use(requireAuth);
crmPanelRouter.use(requireRole('HOST', 'ADMIN'));

crmPanelRouter.get('/pendientes', async (req: Request, res: Response) => {
  res.json({ data: await crmPanelService.pendientes(req.user!.companyId) });
});

crmPanelRouter.get('/indicadores', async (req: Request, res: Response) => {
  // Por defecto, los ultimos 30 dias: es el periodo que se mira al entrar.
  const hasta = req.query.hasta ? new Date(String(req.query.hasta)) : new Date();
  const desde = req.query.desde
    ? new Date(String(req.query.desde))
    : new Date(hasta.getTime() - 30 * 24 * 60 * 60 * 1000);
  res.json({ data: await crmPanelService.indicadores(req.user!.companyId, desde, hasta) });
});
