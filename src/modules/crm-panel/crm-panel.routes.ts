import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { crmPanelService } from './crm-panel.service.js';

/**
 * Como termino una experiencia.
 *
 * La calificacion es opcional: muchas veces se cierra sin mas, y exigirla
 * convertiria un pendiente de un clic en uno que se pospone.
 */
const cerrarExperienciaSchema = z.object({
  resultado: z.enum(['REALIZADA', 'NO_SE_PRESENTO']),
  rating: z.number().int().min(1).max(5).optional(),
  notas: z.string().max(1000).optional(),
  // TR-09 y TR-25. Cuanta gente aparecio. Opcional por lo mismo que la
  // calificacion: si no se dice, se asume lo reservado en una realizada y
  // cero en una que no se presento, que es lo que significan.
  asistentes: z.number().int().min(0).optional(),
});

type CerrarExperienciaInput = z.infer<typeof cerrarExperienciaSchema>;

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

// CRM-26. Cerrar una experiencia ya ocurrida, con su calificacion si la hay.
// Es la accion que resuelve el pendiente, por eso cuelga del panel.
crmPanelRouter.post(
  '/experiencias/:id/cerrar',
  validate(cerrarExperienciaSchema),
  async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Falta el id' } });
      return;
    }
    const r = await crmPanelService.cerrarExperiencia(
      id,
      req.user!.companyId,
      req.body as CerrarExperienciaInput,
    );
    res.json({ data: r });
  },
);

crmPanelRouter.get('/indicadores', async (req: Request, res: Response) => {
  // Por defecto, los ultimos 30 dias: es el periodo que se mira al entrar.
  const hasta = req.query.hasta ? new Date(String(req.query.hasta)) : new Date();
  const desde = req.query.desde
    ? new Date(String(req.query.desde))
    : new Date(hasta.getTime() - 30 * 24 * 60 * 60 * 1000);
  res.json({ data: await crmPanelService.indicadores(req.user!.companyId, desde, hasta) });
});
