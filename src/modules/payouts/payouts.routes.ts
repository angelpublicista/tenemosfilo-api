import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { payoutsService } from './payouts.service.js';
import {
  createPayoutSchema,
  listPayoutsQuerySchema,
  type CreatePayoutInput,
  type ListPayoutsQuery,
} from './payouts.schemas.js';

export const payoutsRouter = Router();

// Mover dinero es cosa del equipo de Tenemos Filo.
payoutsRouter.use(requireAuth, requireHumanAuth, requireRole('ADMIN'));

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
