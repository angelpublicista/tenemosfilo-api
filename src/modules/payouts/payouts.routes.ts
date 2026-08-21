import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { BadRequest } from '../../lib/errors.js';
import { payoutsService } from './payouts.service.js';
import {
  createPayoutSchema,
  listEarningsQuerySchema,
  listPayoutsQuerySchema,
  type CreatePayoutInput,
  type ListEarningsQuery,
  type ListPayoutsQuery,
} from './payouts.schemas.js';

export const payoutsRouter = Router();

payoutsRouter.use(requireAuth, requireHumanAuth);

// ─── Lo propio ───────────────────────────────────────────────────────────
//
// Cada empresa ve sus cuentas: cuanto ha generado, cuanto le han
// transferido y que falta. La empresa sale de la sesion (o de la empresa
// activa del admin), nunca de un parametro, asi que no hay forma de pedir
// las cuentas de otra.

/** La empresa a la que pertenece quien pregunta. */
function empresaDeLaSesion(req: Request): string {
  const companyId = req.user?.companyId;
  if (!companyId) {
    throw BadRequest('Selecciona una empresa para ver sus ingresos');
  }
  return companyId;
}

payoutsRouter.get('/me', async (req: Request, res: Response) => {
  res.json({ data: await payoutsService.resumenEmpresa(empresaDeLaSesion(req)) });
});

payoutsRouter.get(
  '/me/earnings',
  validate(listEarningsQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    const query = req.query as unknown as ListEarningsQuery;
    const { items, total } = await payoutsService.ingresosEmpresa(empresaDeLaSesion(req), query);
    res.json({ data: items, meta: { total, page: query.page, pageSize: query.pageSize } });
  },
);

// ─── Lo de FILO ──────────────────────────────────────────────────────────
// Mover dinero es cosa del equipo de Tenemos Filo.
payoutsRouter.use(requireRole('ADMIN'));

/** Cuanto se le debe a cada empresa, y cuanto retiene FILO. */
payoutsRouter.get('/balances', async (_req: Request, res: Response) => {
  const { items, filoRetained } = await payoutsService.balances();
  res.json({ data: items, meta: { filoRetained } });
});

payoutsRouter.get(
  '/',
  validate(listPayoutsQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    const query = req.query as unknown as ListPayoutsQuery;
    const { items, total } = await payoutsService.list(query);
    res.json({ data: items, meta: { total, page: query.page, pageSize: query.pageSize } });
  },
);

payoutsRouter.post('/', validate(createPayoutSchema), async (req: Request, res: Response) => {
  const payout = await payoutsService.create(req.body as CreatePayoutInput, {
    id: req.user!.id,
    email: req.user!.email,
  });
  res.status(201).json({ data: payout });
});
