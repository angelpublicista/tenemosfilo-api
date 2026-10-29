import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { BadRequest } from '../../lib/errors.js';
import { feesService } from './fees.service.js';
import {
  periodoSchema,
  registrarPagoSchema,
  ventasPropiasQuerySchema,
  type RegistrarPagoInput,
  type VentasPropiasQuery,
} from './fees.schemas.js';

export const feesRouter = Router();

feesRouter.use(requireAuth, requireHumanAuth);

// ─── Lo propio ───────────────────────────────────────────────────────────
// La empresa sale de la sesion, nunca de un parametro: no hay forma de pedir
// el balance de otra.

function empresaDeLaSesion(req: Request): string {
  const companyId = req.user?.companyId;
  if (!companyId) throw BadRequest('Selecciona una empresa para ver sus comisiones');
  return companyId;
}

feesRouter.get('/me', async (req: Request, res: Response) => {
  const filas = await feesService.balances({ companyId: empresaDeLaSesion(req) });
  res.json({ data: filas });
});

feesRouter.get(
  '/me/:period',
  validate(z.object({ period: periodoSchema }), 'params'),
  async (req: Request, res: Response) => {
    const { period } = req.params as { period: string };
    res.json({ data: await feesService.detalle(empresaDeLaSesion(req), period) });
  },
);

// ─── Lo de FILO ──────────────────────────────────────────────────────────
// Facturar y dar un mes por pagado es cosa del equipo de Tenemos Filo.
feesRouter.use(requireRole('ADMIN'));

feesRouter.get('/', async (_req: Request, res: Response) => {
  res.json({ data: await feesService.balances() });
});

feesRouter.get('/ventas', validate(ventasPropiasQuerySchema, 'query'), async (req: Request, res: Response) => {
  const q = req.query as unknown as VentasPropiasQuery;
  const { items, total, totals } = await feesService.ventasPropias(q);
  res.json({ data: items, meta: { total, page: q.page, pageSize: q.pageSize, totals } });
});

feesRouter.post('/payments', validate(registrarPagoSchema), async (req: Request, res: Response) => {
  const pago = await feesService.registrarPago(req.body as RegistrarPagoInput, {
    id: req.user!.id,
    email: req.user!.email,
  });
  res.status(201).json({ data: pago });
});

feesRouter.delete(
  '/payments/:id',
  validate(z.object({ id: z.string().min(1) }), 'params'),
  async (req: Request, res: Response) => {
    await feesService.deshacerPago((req.params as { id: string }).id);
    res.status(204).end();
  },
);

feesRouter.get(
  '/:companyId/:period',
  validate(z.object({ companyId: z.string().min(1), period: periodoSchema }), 'params'),
  async (req: Request, res: Response) => {
    const { companyId, period } = req.params as { companyId: string; period: string };
    res.json({ data: await feesService.detalle(companyId, period) });
  },
);
