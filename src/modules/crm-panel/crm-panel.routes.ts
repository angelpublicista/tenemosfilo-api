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

crmPanelRouter.patch('/seguimientos/:id', async (req: Request, res: Response) => {
  const { status } = (req.body ?? {}) as { status?: string };
  if (status !== 'HECHO' && status !== 'NO_APLICA') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Estado no válido' } });
    return;
  }
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Falta el id' } });
    return;
  }
  const f = await crmPanelService.cerrarSeguimiento(id, req.user!.companyId, status);
  res.json({ data: f });
});

crmPanelRouter.get('/indicadores', async (req: Request, res: Response) => {
  // Por defecto, los ultimos 30 dias: es el periodo que se mira al entrar.
  const hasta = req.query.hasta ? new Date(String(req.query.hasta)) : new Date();
  const desde = req.query.desde
    ? new Date(String(req.query.desde))
    : new Date(hasta.getTime() - 30 * 24 * 60 * 60 * 1000);
  res.json({ data: await crmPanelService.indicadores(req.user!.companyId, desde, hasta) });
});
