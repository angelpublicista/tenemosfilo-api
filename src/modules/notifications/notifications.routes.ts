// Bandeja de notificaciones de quien llama.
//
// No hay endpoint para crear: las notificaciones las genera el sistema como
// efecto de lo que pasa (una reserva, un pago). Si cualquiera pudiera
// insertarlas, la bandeja dejaria de ser fiable.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { NotFound } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';

export const notificationsRouter = Router();

// Solo humanos: una API key no tiene bandeja.
notificationsRouter.use(requireAuth, requireHumanAuth);

const listQuerySchema = z.object({
  soloSinLeer: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

notificationsRouter.get(
  '/',
  validate(listQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    const { soloSinLeer, limit } = req.query as unknown as z.infer<typeof listQuerySchema>;
    const userId = req.user!.id;

    const [items, sinLeer] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, ...(soloSinLeer ? { read: false } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);

    res.json({ data: items, meta: { sinLeer } });
  },
);

/** Marcar una como leida. Solo las propias: el where lleva el userId. */
notificationsRouter.patch(
  '/:id/read',
  validate(idParamsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    const { count } = await prisma.notification.updateMany({
      where: { id, userId: req.user!.id },
      data: { read: true, readAt: new Date() },
    });
    if (count === 0) throw NotFound('Notificación no encontrada');
    res.status(204).send();
  },
);

notificationsRouter.post('/read-all', async (req: Request, res: Response) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: req.user!.id, read: false },
    data: { read: true, readAt: new Date() },
  });
  res.json({ data: { marcadas: count } });
});

notificationsRouter.delete(
  '/:id',
  validate(idParamsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    const { count } = await prisma.notification.deleteMany({
      where: { id, userId: req.user!.id },
    });
    if (count === 0) throw NotFound('Notificación no encontrada');
    res.status(204).send();
  },
);

notificationsRouter.delete('/', async (req: Request, res: Response) => {
  const { count } = await prisma.notification.deleteMany({ where: { userId: req.user!.id } });
  res.json({ data: { borradas: count } });
});
